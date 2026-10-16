package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Actor identifie l'utilisateur authentifié et sa session courante.
type Actor struct {
	UserID    uuid.UUID
	Role      string
	SessionID string
}

func errIncorrectPassword(field string) error {
	return apperr.Validation(apperr.FieldError{Field: field, Code: "incorrect", Message: "is incorrect"})
}

// verifyCurrentPassword exige le mot de passe courant (actions sensibles).
func (s *Service) verifyCurrentPassword(ctx context.Context, uid uuid.UUID, field, password string) (dbgen.GetUserCredentialsRow, error) {
	creds, err := s.Store.GetUserCredentials(ctx, uid)
	if err != nil {
		return creds, fmt.Errorf("auth: load credentials: %w", store.Translate(err))
	}
	ok, _, err := s.Hasher.Verify(ctx, password, creds.PasswordHash)
	if err != nil {
		return creds, err
	}
	if !ok {
		return creds, errIncorrectPassword(field)
	}
	return creds, nil
}

// UpdateProfile modifie prénom et/ou nom.
func (s *Service) UpdateProfile(ctx context.Context, uid uuid.UUID, firstName, lastName *string) (Profile, error) {
	v := &validator{}
	p := dbgen.UpdateUserProfileParams{ID: uid}
	if firstName != nil {
		p.FirstName = ptr(v.text("firstName", *firstName, 1, 100))
	}
	if lastName != nil {
		p.LastName = ptr(v.text("lastName", *lastName, 1, 100))
	}
	if err := v.err(); err != nil {
		return Profile{}, err
	}
	if err := s.Store.UpdateUserProfile(ctx, p); err != nil {
		return Profile{}, fmt.Errorf("auth: update profile: %w", err)
	}
	return s.Profile(ctx, uid)
}

// AcceptPrivacyPolicy enregistre l'acceptation de la version courante.
func (s *Service) AcceptPrivacyPolicy(ctx context.Context, uid uuid.UUID, version string) (Profile, error) {
	if version != s.cfg.PrivacyPolicyVersion {
		return Profile{}, apperr.Validation(apperr.FieldError{
			Field: "version", Code: "outdated",
			Message: "the current privacy policy (" + s.cfg.PrivacyPolicyVersion + ") must be accepted",
		})
	}
	if err := s.Store.AcceptPrivacyPolicy(ctx, dbgen.AcceptPrivacyPolicyParams{ID: uid, Version: version}); err != nil {
		return Profile{}, fmt.Errorf("auth: accept privacy policy: %w", err)
	}
	return s.Profile(ctx, uid)
}

// ChangePassword change le mot de passe et révoque les autres sessions (la courante reste).
func (s *Service) ChangePassword(ctx context.Context, a Actor, current, next string) error {
	creds, err := s.verifyCurrentPassword(ctx, a.UserID, "currentPassword", current)
	if err != nil {
		return err
	}
	if err := s.Policy.Validate("newPassword", next, creds.Email); err != nil {
		return err
	}
	if current == next {
		return apperr.Validation(apperr.FieldError{Field: "newPassword", Code: "unchanged", Message: "must differ from the current password"})
	}
	hash, err := s.Hasher.Hash(ctx, next)
	if err != nil {
		return err
	}
	if err := s.Store.UpdateUserPassword(ctx, dbgen.UpdateUserPasswordParams{ID: a.UserID, PasswordHash: hash}); err != nil {
		return fmt.Errorf("auth: change password: %w", err)
	}
	if err := s.Sessions.RevokeAll(ctx, a.UserID, a.SessionID); err != nil {
		return err
	}
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &a.UserID, ActorRole: a.Role, Action: audit.ActionPasswordChanged,
		EntityType: "user", EntityID: a.UserID.String(),
	})
	s.notifyPasswordChanged(ctx, a.UserID)
	return nil
}

// ListSessions renvoie les sessions actives de l'utilisateur.
func (s *Service) ListSessions(ctx context.Context, uid uuid.UUID) ([]Session, error) {
	return s.Sessions.List(ctx, uid)
}

// RevokeSession révoque une session de l'utilisateur ; celle d'un autre compte répond 404.
func (s *Service) RevokeSession(ctx context.Context, a Actor, sessionID string) error {
	sess, err := s.Sessions.Get(ctx, sessionID)
	if errors.Is(err, ErrSessionNotFound) || (err == nil && sess.UserID != a.UserID) {
		return apperr.NotFound("Session not found.")
	}
	if err != nil {
		return err
	}
	if err := s.Sessions.Revoke(ctx, sessionID); err != nil {
		return err
	}
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &a.UserID, ActorRole: a.Role, Action: audit.ActionSessionRevoked,
		EntityType: "session", EntityID: sessionID,
	})
	return nil
}

// VerifyPassword contrôle le mot de passe du compte connecté (confirmation de la suppression du
// compte, étape 10A : internal/privacy).
func (s *Service) VerifyPassword(ctx context.Context, uid uuid.UUID, password string) error {
	_, err := s.verifyCurrentPassword(ctx, uid, "password", password)
	return err
}

// EmailVerified indique si l'email du compte est vérifié et le compte actif (middleware).
func (s *Service) EmailVerified(ctx context.Context, uid uuid.UUID) (bool, error) {
	acc, err := s.Store.GetUserAccess(ctx, uid)
	if store.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("auth: load access: %w", err)
	}
	return acc.Status == dbgen.UserStatusActive && acc.EmailVerifiedAt != nil, nil
}

// CreateAdmin crée un compte admin (CLI uniquement). L'email est considéré comme vérifié ;
// la 2FA sera configurée au premier login.
func (s *Service) CreateAdmin(ctx context.Context, email, firstName, lastName, password string) (uuid.UUID, error) {
	v := &validator{}
	in := AccountInput{
		FirstName: v.text("firstName", firstName, 1, 100), LastName: v.text("lastName", lastName, 1, 100),
		Email: v.email("email", email), Password: password, PrivacyPolicyVersion: s.cfg.PrivacyPolicyVersion,
	}
	s.checkPassword(v, "password", password, in.Email)
	if err := v.err(); err != nil {
		return uuid.Nil, err
	}
	var uid uuid.UUID
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		var err error
		if uid, err = s.createUser(ctx, q, in, dbgen.UserRoleAdmin); err != nil {
			return err
		}
		return q.MarkEmailVerified(ctx, uid)
	})
	if err != nil {
		return uuid.Nil, err
	}
	s.Audit.Log(ctx, audit.Entry{
		Action: audit.ActionAdminCreated, EntityType: "user", EntityID: uid.String(),
		Metadata: map[string]any{"via": "cli"},
	})
	return uid, nil
}

// ResetAdmin2FA supprime le secret TOTP et les codes de secours d'un admin (CLI) et révoque
// ses sessions : la 2FA sera reconfigurée au prochain login.
func (s *Service) ResetAdmin2FA(ctx context.Context, email string) (uuid.UUID, error) {
	u, err := s.Store.GetUserByEmail(ctx, email)
	if err != nil {
		return uuid.Nil, fmt.Errorf("auth: load admin: %w", store.Translate(err))
	}
	if u.Role != dbgen.UserRoleAdmin {
		return uuid.Nil, apperr.New(http.StatusUnprocessableEntity, apperr.CodeValidation, "This account is not an admin.")
	}
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.DisableUserTOTP(ctx, u.ID); err != nil {
			return err
		}
		return q.DeleteRecoveryCodes(ctx, u.ID)
	})
	if err != nil {
		return uuid.Nil, fmt.Errorf("auth: reset 2fa: %w", err)
	}
	if err := s.Sessions.RevokeAll(ctx, u.ID, ""); err != nil {
		return uuid.Nil, err
	}
	s.Audit.Log(ctx, audit.Entry{
		Action: audit.ActionAdminTwoFactorReset, EntityType: "user", EntityID: u.ID.String(),
		Metadata: map[string]any{"via": "cli"},
	})
	return u.ID, nil
}
