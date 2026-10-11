package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/pagination"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Gestion des comptes par l'admin (étape 7) : liste, détail, désactivation et réactivation,
// renvoi du code de vérification. Chaque action exige un motif et passe au journal d'audit. Pas de
// modification du nom ou de l'email ni de suppression par l'admin (étape 9). Les comptes admin se
// gèrent uniquement par la CLI.

// Codes d'erreur stables de la gestion des comptes.
const (
	CodeAccountDisabled = "auth.account_disabled"
	CodeAdminProtected  = "user.admin_protected"
	CodeInvalidStatus   = "user.invalid_status"
	CodeAlreadyVerified = "user.already_verified"
)

func errAccountDisabled() *apperr.Error {
	return apperr.New(http.StatusForbidden, CodeAccountDisabled, "This account has been disabled. Contact GoStation support.")
}

// UserFilter filtre la liste admin des comptes.
type UserFilter struct {
	Query         string
	Role          string
	Status        string
	EmailVerified *bool
	Cursor        string
	Limit         int
}

// UserPage est une page de comptes.
type UserPage struct {
	Items      []dbgen.ListUsersForAdminRow
	NextCursor string
}

// likeEscaper protège les jokers de LIKE dans la recherche.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// ListUsers liste les comptes, les plus récents d'abord ; recherche par nom ou email.
func (s *Service) ListUsers(ctx context.Context, f UserFilter) (UserPage, error) {
	v := &validator{}
	limit, err := pagination.Limit(f.Limit)
	if err != nil {
		return UserPage{}, err
	}
	p := dbgen.ListUsersForAdminParams{EmailVerified: f.EmailVerified, PageSize: int32(limit + 1)} //nolint:gosec // ≤ 101
	if f.Role != "" {
		r := dbgen.UserRole(f.Role)
		if !r.Valid() {
			v.add("role", "invalid", "must be user, manager or admin")
		}
		p.Role = &r
	}
	if f.Status != "" {
		st := dbgen.UserStatus(f.Status)
		if !st.Valid() {
			v.add("status", "invalid", "must be active, disabled or pending_deletion")
		}
		p.Status = &st
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		if utf8.RuneCountInString(q) > 100 {
			v.add("q", "too_long", "must be at most 100 characters")
		}
		escaped := likeEscaper.Replace(q)
		p.Query = &escaped
	}
	if err := v.err(); err != nil {
		return UserPage{}, err
	}
	if f.Cursor != "" {
		t, id, err := pagination.Decode(f.Cursor)
		if err != nil {
			return UserPage{}, err
		}
		uid, err := uuid.Parse(id)
		if err != nil {
			return UserPage{}, apperr.BadRequest(apperr.CodeInvalidParameter, "Invalid cursor.")
		}
		p.CursorCreatedAt, p.CursorID = &t, &uid
	}
	rows, err := s.Store.ListUsersForAdmin(ctx, p)
	if err != nil {
		return UserPage{}, fmt.Errorf("auth: list users: %w", err)
	}
	page := UserPage{Items: rows}
	if len(rows) > limit {
		page.Items = rows[:limit]
		last := page.Items[limit-1]
		page.NextCursor = pagination.Encode(last.CreatedAt, last.ID.String())
	}
	return page, nil
}

// UserDetail est la fiche admin d'un compte.
type UserDetail struct {
	dbgen.GetUserForAdminRow
	ActiveSessions int
}

// UserDetail renvoie le profil d'un compte, ses sessions actives (nombre), ses signalements (total
// et abusifs), ses favoris et ses appareils (nombres), et sa station pour un gérant.
func (s *Service) UserDetail(ctx context.Context, id uuid.UUID) (UserDetail, error) {
	row, err := s.Store.GetUserForAdmin(ctx, id)
	if err != nil {
		return UserDetail{}, fmt.Errorf("auth: load user: %w", store.Translate(err))
	}
	sessions, err := s.Sessions.List(ctx, id)
	if err != nil {
		return UserDetail{}, err
	}
	return UserDetail{GetUserForAdminRow: row, ActiveSessions: len(sessions)}, nil
}

// AdminReason valide le motif obligatoire d'une action admin sur un compte (3 à 500 caractères).
func AdminReason(reason string) (string, error) {
	r := strings.TrimSpace(reason)
	if n := utf8.RuneCountInString(r); n < 3 || n > 500 {
		return "", apperr.Validation(apperr.FieldError{Field: "reason", Code: "required", Message: "a reason of 3 to 500 characters is required"})
	}
	return r, nil
}

// targetUser charge le compte visé par une action admin : 404 s'il n'existe pas, 403 pour un admin.
func (s *Service) targetUser(ctx context.Context, id uuid.UUID) (dbgen.GetUserForAdminRow, error) {
	u, err := s.Store.GetUserForAdmin(ctx, id)
	if err != nil {
		return u, fmt.Errorf("auth: load user: %w", store.Translate(err))
	}
	if u.Role == dbgen.UserRoleAdmin {
		return u, apperr.New(http.StatusForbidden, CodeAdminProtected, "Admin accounts are managed with the admin CLI.")
	}
	return u, nil
}

func (s *Service) auditUser(ctx context.Context, a Actor, action string, uid uuid.UUID, meta map[string]any) {
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &a.UserID, ActorRole: a.Role, Action: action, EntityType: "user", EntityID: uid.String(), Metadata: meta,
	})
}

// DisableUser désactive un compte : toutes ses sessions sont révoquées (ses appareils push avec
// elles), ses tokens push restants supprimés, et la connexion est refusée avec un message dédié
// (auth.account_disabled) jusqu'à la réactivation. La station d'un gérant n'est pas suspendue :
// faute de mise à jour, elle sort de la recherche à 24 h (l'admin peut la suspendre à part).
func (s *Service) DisableUser(ctx context.Context, a Actor, id uuid.UUID, reason string) (UserDetail, error) {
	r, err := AdminReason(reason)
	if err != nil {
		return UserDetail{}, err
	}
	u, err := s.targetUser(ctx, id)
	if err != nil {
		return UserDetail{}, err
	}
	n, err := s.Store.DisableUser(ctx, dbgen.DisableUserParams{ID: id, Reason: &r})
	if err != nil {
		return UserDetail{}, fmt.Errorf("auth: disable user: %w", err)
	}
	if n == 0 {
		return UserDetail{}, apperr.New(http.StatusConflict, CodeInvalidStatus, "Only an active account can be disabled.").WithMeta("userStatus", string(u.Status))
	}
	// Le statut est écrit avant la révocation : une session ouverte entre-temps ne survit pas au
	// prochain refresh (Refresh vérifie le statut du compte).
	if err := s.Sessions.RevokeAll(ctx, id, ""); err != nil {
		return UserDetail{}, err
	}
	if err := s.Store.DeleteUserDeviceTokens(ctx, id); err != nil {
		return UserDetail{}, fmt.Errorf("auth: delete devices: %w", err)
	}
	s.auditUser(ctx, a, audit.ActionUserDisabled, id, map[string]any{"reason": r})
	return s.UserDetail(ctx, id)
}

// ReactivateUser réactive un compte désactivé (il se reconnecte normalement).
func (s *Service) ReactivateUser(ctx context.Context, a Actor, id uuid.UUID, reason string) (UserDetail, error) {
	r, err := AdminReason(reason)
	if err != nil {
		return UserDetail{}, err
	}
	u, err := s.targetUser(ctx, id)
	if err != nil {
		return UserDetail{}, err
	}
	n, err := s.Store.ReactivateUser(ctx, id)
	if err != nil {
		return UserDetail{}, fmt.Errorf("auth: reactivate user: %w", err)
	}
	if n == 0 {
		return UserDetail{}, apperr.New(http.StatusConflict, CodeInvalidStatus, "Only a disabled account can be reactivated.").WithMeta("userStatus", string(u.Status))
	}
	s.auditUser(ctx, a, audit.ActionUserReactivated, id, map[string]any{"reason": r})
	return s.UserDetail(ctx, id)
}

// AdminResendVerification renvoie un code de vérification à un compte actif non vérifié, dans les
// limites de renvoi habituelles (1 par minute, 5 par heure : 429 au-delà).
func (s *Service) AdminResendVerification(ctx context.Context, a Actor, id uuid.UUID, reason string) error {
	r, err := AdminReason(reason)
	if err != nil {
		return err
	}
	u, err := s.targetUser(ctx, id)
	if err != nil {
		return err
	}
	switch {
	case u.Status != dbgen.UserStatusActive:
		return apperr.New(http.StatusConflict, CodeInvalidStatus, "The account is not active.").WithMeta("userStatus", string(u.Status))
	case u.EmailVerifiedAt != nil:
		return apperr.New(http.StatusConflict, CodeAlreadyVerified, "The email address is already verified.")
	}
	code, err := s.OTPs.Issue(ctx, PurposeVerifyEmail, id)
	if errors.Is(err, ErrResendTooSoon) || errors.Is(err, ErrResendExhausted) {
		return apperr.TooManyRequests("A verification code was sent too recently; try again later.")
	}
	if err != nil {
		return err
	}
	m, err := s.Templates.VerifyEmail(u.Email, u.FirstName, code, OTPTTL)
	if err == nil {
		err = s.Mailer.Send(ctx, m)
	}
	if err != nil {
		return fmt.Errorf("auth: send verification email: %w", err)
	}
	s.auditUser(ctx, a, audit.ActionVerificationResent, id, map[string]any{"reason": r})
	return nil
}
