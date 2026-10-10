package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"gostation/backend/internal/audit"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// VerifyEmail consomme le code de vérification. Email inconnu, code faux ou expiré : même
// réponse générique (pas d'énumération).
func (s *Service) VerifyEmail(ctx context.Context, email, code string) error {
	u, err := s.Store.GetUserByEmail(ctx, strings.TrimSpace(email))
	if store.IsNotFound(err) {
		return errInvalidCode()
	}
	if err != nil {
		return fmt.Errorf("auth: load user: %w", err)
	}
	if u.EmailVerifiedAt != nil {
		return nil // déjà vérifié : idempotent
	}
	if err := s.OTPs.Verify(ctx, PurposeVerifyEmail, u.ID, strings.TrimSpace(code)); err != nil {
		if errors.Is(err, ErrInvalidCode) {
			return errInvalidCode()
		}
		return err
	}
	if err := s.Store.MarkEmailVerified(ctx, u.ID); err != nil {
		return fmt.Errorf("auth: mark email verified: %w", err)
	}
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &u.ID, ActorRole: string(u.Role), Action: audit.ActionEmailVerified,
		EntityType: "user", EntityID: u.ID.String(),
	})
	return nil
}

// ResendVerification renvoie un code si le compte existe, n'est pas vérifié et respecte les
// limites de renvoi. Le résultat n'est jamais communiqué au client (réponse générique).
func (s *Service) ResendVerification(ctx context.Context, email string) error {
	u, err := s.Store.GetUserByEmail(ctx, strings.TrimSpace(email))
	if store.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("auth: load user: %w", err)
	}
	if u.EmailVerifiedAt != nil || u.Status != dbgen.UserStatusActive {
		return nil
	}
	p, err := s.Store.GetUserByID(ctx, u.ID)
	if err != nil {
		return fmt.Errorf("auth: load user: %w", err)
	}
	s.issueAndSend(ctx, PurposeVerifyEmail, u.ID, p.Email, p.FirstName)
	return nil
}

// ForgotPassword envoie un code de réinitialisation si le compte existe (réponse générique).
func (s *Service) ForgotPassword(ctx context.Context, email string) error {
	u, err := s.Store.GetUserByEmail(ctx, strings.TrimSpace(email))
	if store.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("auth: load user: %w", err)
	}
	if u.Status != dbgen.UserStatusActive {
		return nil
	}
	p, err := s.Store.GetUserByID(ctx, u.ID)
	if err != nil {
		return fmt.Errorf("auth: load user: %w", err)
	}
	s.issueAndSend(ctx, PurposeResetPassword, u.ID, p.Email, p.FirstName)
	return nil
}

// ResetPassword change le mot de passe avec un code valide et révoque toutes les sessions.
// Réussir la réinitialisation prouve aussi la possession de l'adresse : l'email est vérifié.
func (s *Service) ResetPassword(ctx context.Context, email, code, newPassword string) error {
	email = strings.TrimSpace(email)
	u, err := s.Store.GetUserByEmail(ctx, email)
	if store.IsNotFound(err) {
		return errInvalidCode()
	}
	if err != nil {
		return fmt.Errorf("auth: load user: %w", err)
	}
	if u.Status != dbgen.UserStatusActive {
		return errInvalidCode()
	}
	// La politique est vérifiée avant de consommer le code : un mot de passe refusé ne
	// coûte pas d'essai à l'utilisateur.
	if err := s.Policy.Validate("newPassword", newPassword, email); err != nil {
		return err
	}
	if err := s.OTPs.Verify(ctx, PurposeResetPassword, u.ID, strings.TrimSpace(code)); err != nil {
		if errors.Is(err, ErrInvalidCode) {
			return errInvalidCode()
		}
		return err
	}
	hash, err := s.Hasher.Hash(ctx, newPassword)
	if err != nil {
		return err
	}
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.UpdateUserPassword(ctx, dbgen.UpdateUserPasswordParams{ID: u.ID, PasswordHash: hash}); err != nil {
			return err
		}
		return q.MarkEmailVerified(ctx, u.ID)
	})
	if err != nil {
		return fmt.Errorf("auth: reset password: %w", err)
	}
	if err := s.Sessions.RevokeAll(ctx, u.ID, ""); err != nil {
		return err
	}
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &u.ID, ActorRole: string(u.Role), Action: audit.ActionPasswordReset,
		EntityType: "user", EntityID: u.ID.String(),
	})
	s.notifyPasswordChanged(ctx, u.ID)
	return nil
}

func (s *Service) notifyPasswordChanged(ctx context.Context, uid uuid.UUID) {
	p, err := s.Store.GetUserByID(ctx, uid)
	if err != nil {
		return
	}
	m, err := s.Templates.PasswordChanged(p.Email, p.FirstName, s.now())
	s.sendEmail(ctx, m, err)
}
