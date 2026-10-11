package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"gostation/backend/internal/audit"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// checkCredentials vérifie email + mot de passe en temps constant, que le compte existe ou
// non. Un compte en suppression échoue comme un mauvais mot de passe ; un compte désactivé par
// l'admin reçoit un message dédié, mais seulement avec le bon mot de passe (pas d'énumération).
func (s *Service) checkCredentials(ctx context.Context, email, password string) (dbgen.GetUserByEmailRow, string, error) {
	email = strings.TrimSpace(email)
	u, err := s.Store.GetUserByEmail(ctx, email)
	if store.IsNotFound(err) {
		s.Hasher.VerifyDummy(ctx, password)
		return u, "unknown_email", errInvalidCredentials()
	}
	if err != nil {
		return u, "", fmt.Errorf("auth: load user: %w", err)
	}
	ok, rehash, err := s.Hasher.Verify(ctx, password, u.PasswordHash)
	if err != nil {
		return u, "", err
	}
	if !ok {
		return u, "bad_password", errInvalidCredentials()
	}
	if u.Status == dbgen.UserStatusDisabled {
		return u, "disabled_account", errAccountDisabled()
	}
	if u.Status != dbgen.UserStatusActive {
		return u, "inactive_account", errInvalidCredentials()
	}
	if rehash {
		if h, err := s.Hasher.Hash(ctx, password); err == nil {
			if err := s.Store.RehashUserPassword(ctx, dbgen.RehashUserPasswordParams{ID: u.ID, PasswordHash: h}); err != nil {
				s.Log.WarnContext(ctx, "auth: rehash password", slog.Any("err", err))
			}
		}
	}
	return u, "", nil
}

func (s *Service) auditLoginFailure(ctx context.Context, action string, u dbgen.GetUserByEmailRow, email, reason string) {
	e := audit.Entry{
		Action: action, EntityType: "user",
		Metadata: map[string]any{"reason": reason, "emailFingerprint": s.emailFP(email)},
	}
	if u.ID != uuid.Nil {
		e.EntityID = u.ID.String()
	}
	s.Audit.Log(ctx, e)
}

// Login connecte un utilisateur ou un gérant (client mobile). Les admins passent par
// AdminLogin : ici, leur compte répond comme un mauvais mot de passe.
func (s *Service) Login(ctx context.Context, email, password string, meta ClientMeta) (TokenPair, Profile, error) {
	u, reason, err := s.checkCredentials(ctx, email, password)
	if err == nil && u.Role == dbgen.UserRoleAdmin {
		reason, err = "admin_on_user_login", errInvalidCredentials()
	}
	if err != nil {
		if reason != "" {
			s.auditLoginFailure(ctx, audit.ActionLoginFailed, u, email, reason)
		}
		return TokenPair{}, Profile{}, err
	}
	tokens, err := s.openSession(ctx, u.ID, string(u.Role), false, meta)
	if err != nil {
		return TokenPair{}, Profile{}, err
	}
	_ = s.Store.TouchLastLogin(ctx, u.ID)
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &u.ID, ActorRole: string(u.Role), Action: audit.ActionLoginSucceeded,
		EntityType: "user", EntityID: u.ID.String(), Metadata: map[string]any{"client": meta.Client, "sessionId": tokens.SessionID},
	})
	p, err := s.Profile(ctx, u.ID)
	return tokens, p, err
}

// Refresh fait tourner le refresh token. Un token déjà consommé révoque la session entière.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (TokenPair, Session, error) {
	sess, newRefresh, err := s.Sessions.Rotate(ctx, refreshToken)
	switch {
	case errors.Is(err, ErrRefreshTokenReused):
		e := audit.Entry{Action: audit.ActionRefreshReuseDetected, EntityType: "session", EntityID: sess.ID}
		if sess.UserID != uuid.Nil {
			e.ActorID, e.ActorRole = &sess.UserID, sess.Role
		}
		s.Audit.Log(ctx, e)
		s.Log.WarnContext(ctx, "auth: refresh token reuse detected, session revoked", slog.String("session_id", sess.ID))
		return TokenPair{}, Session{}, errInvalidRefresh().Wrap(err)
	case errors.Is(err, ErrInvalidRefreshToken):
		return TokenPair{}, Session{}, errInvalidRefresh().Wrap(err)
	case err != nil:
		return TokenPair{}, Session{}, err
	}
	// Un compte désactivé entre-temps perd sa session.
	if acc, err := s.Store.GetUserAccess(ctx, sess.UserID); err != nil || acc.Status != dbgen.UserStatusActive {
		_ = s.Sessions.Revoke(ctx, sess.ID)
		return TokenPair{}, Session{}, errInvalidRefresh()
	}
	access, err := s.Tokens.Issue(sess.UserID, sess.Role, sess.ID, sess.MFA)
	if err != nil {
		return TokenPair{}, Session{}, err
	}
	ttl := s.cfg.RefreshTTL
	if sess.Role == string(dbgen.UserRoleAdmin) {
		ttl = s.cfg.AdminRefreshTTL
	}
	return TokenPair{
		AccessToken: access, ExpiresIn: s.Tokens.TTL(), RefreshToken: newRefresh,
		RefreshExpiresIn: ttl, SessionID: sess.ID,
	}, sess, nil
}

// SessionForRefreshToken renvoie la session d'un refresh token sans le consommer (contrôle CSRF
// des requêtes de l'admin web qui s'appuient sur le cookie de refresh).
func (s *Service) SessionForRefreshToken(ctx context.Context, refreshToken string) (Session, error) {
	return s.Sessions.Lookup(ctx, refreshToken)
}

// Logout révoque une session (idempotent).
func (s *Service) Logout(ctx context.Context, uid uuid.UUID, role, sessionID string) error {
	if err := s.Sessions.Revoke(ctx, sessionID); err != nil {
		return err
	}
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &uid, ActorRole: role, Action: audit.ActionLogout,
		EntityType: "session", EntityID: sessionID,
	})
	return nil
}

// LogoutByRefreshToken révoque la session d'un refresh token (client dont l'access a expiré).
func (s *Service) LogoutByRefreshToken(ctx context.Context, refreshToken string) error {
	sess, err := s.Sessions.Lookup(ctx, refreshToken)
	if errors.Is(err, ErrInvalidRefreshToken) || errors.Is(err, ErrSessionNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	return s.Logout(ctx, sess.UserID, sess.Role, sess.ID)
}

// LogoutAll révoque toutes les sessions de l'utilisateur.
func (s *Service) LogoutAll(ctx context.Context, uid uuid.UUID, role string) error {
	if err := s.Sessions.RevokeAll(ctx, uid, ""); err != nil {
		return err
	}
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &uid, ActorRole: role, Action: audit.ActionLogoutAll,
		EntityType: "user", EntityID: uid.String(),
	})
	return nil
}

// AdminChallenge est la réponse de la première étape du login admin.
type AdminChallenge struct {
	MFAToken      string
	SetupRequired bool
	// Secret et URI ne sont renseignés que pendant la mise en place de la 2FA.
	Secret string
	URI    string
}

// AdminLogin vérifie le mot de passe d'un admin et ouvre un défi 2FA. Aucune session n'est
// créée à ce stade (D7). Un compte non admin répond comme un mauvais mot de passe.
func (s *Service) AdminLogin(ctx context.Context, email, password string) (AdminChallenge, error) {
	u, reason, err := s.checkCredentials(ctx, email, password)
	if err == nil && u.Role != dbgen.UserRoleAdmin {
		reason, err = "not_admin", errInvalidCredentials()
	}
	if err != nil {
		if reason != "" {
			s.auditLoginFailure(ctx, audit.ActionAdminLoginFailed, u, email, reason)
		}
		return AdminChallenge{}, err
	}
	if u.TotpEnabledAt != nil {
		token, err := s.MFA.Start(ctx, u.ID, nil)
		return AdminChallenge{MFAToken: token}, err
	}
	secret := NewTOTPSecret()
	token, err := s.MFA.Start(ctx, u.ID, s.TOTPSealer.Seal(secret, u.ID[:]))
	if err != nil {
		return AdminChallenge{}, err
	}
	return AdminChallenge{
		MFAToken: token, SetupRequired: true,
		Secret: TOTPSecretBase32(secret), URI: TOTPURI(secret, u.Email),
	}, nil
}

// AdminSecondFactor termine le login admin avec un code TOTP ou un code de secours.
// À la mise en place, le secret est enregistré et 10 codes de secours sont renvoyés (une fois).
func (s *Service) AdminSecondFactor(ctx context.Context, mfaToken, code, recoveryCode string, meta ClientMeta) (TokenPair, Profile, []string, error) {
	ch, err := s.MFA.Get(ctx, mfaToken)
	if errors.Is(err, ErrInvalidMFAToken) {
		return TokenPair{}, Profile{}, nil, errInvalidMFAToken().Wrap(err)
	}
	if err != nil {
		return TokenPair{}, Profile{}, nil, err
	}
	creds, err := s.Store.GetUserCredentials(ctx, ch.UserID)
	if err != nil || creds.Role != dbgen.UserRoleAdmin || creds.Status != dbgen.UserStatusActive {
		_ = s.MFA.Consume(ctx, mfaToken)
		return TokenPair{}, Profile{}, nil, errInvalidMFAToken()
	}

	var recovery []string
	method := "totp"
	switch {
	case ch.PendingSecret != nil: // mise en place
		secret, err := s.TOTPSealer.Open(ch.PendingSecret, ch.UserID[:])
		if err != nil {
			return TokenPair{}, Profile{}, nil, fmt.Errorf("auth: open pending totp secret: %w", err)
		}
		if !s.acceptTOTP(ctx, ch.UserID, secret, code) {
			return TokenPair{}, Profile{}, nil, s.secondFactorFailed(ctx, mfaToken, ch.UserID, "setup")
		}
		if recovery, err = s.enableTOTP(ctx, ch.UserID, secret); err != nil {
			return TokenPair{}, Profile{}, nil, err
		}
		method = "totp_setup"
	case recoveryCode != "":
		_, err := s.Store.UseRecoveryCode(ctx, dbgen.UseRecoveryCodeParams{UserID: ch.UserID, CodeHash: HashRecoveryCode(recoveryCode)})
		if store.IsNotFound(err) {
			return TokenPair{}, Profile{}, nil, s.secondFactorFailed(ctx, mfaToken, ch.UserID, "recovery_code")
		}
		if err != nil {
			return TokenPair{}, Profile{}, nil, fmt.Errorf("auth: use recovery code: %w", err)
		}
		left, _ := s.Store.CountUnusedRecoveryCodes(ctx, ch.UserID)
		s.Audit.Log(ctx, audit.Entry{
			ActorID: &ch.UserID, ActorRole: string(dbgen.UserRoleAdmin),
			Action: audit.ActionRecoveryCodeUsed, EntityType: "user", EntityID: ch.UserID.String(),
			Metadata: map[string]any{"remaining": left},
		})
		method = "recovery_code"
	default:
		secret, err := s.TOTPSealer.Open(creds.TotpSecretEncrypted, ch.UserID[:])
		if err != nil {
			return TokenPair{}, Profile{}, nil, fmt.Errorf("auth: open totp secret: %w", err)
		}
		if !s.acceptTOTP(ctx, ch.UserID, secret, code) {
			return TokenPair{}, Profile{}, nil, s.secondFactorFailed(ctx, mfaToken, ch.UserID, "totp")
		}
	}

	_ = s.MFA.Consume(ctx, mfaToken)
	tokens, err := s.openSession(ctx, ch.UserID, string(dbgen.UserRoleAdmin), true, meta)
	if err != nil {
		return TokenPair{}, Profile{}, nil, err
	}
	_ = s.Store.TouchLastLogin(ctx, ch.UserID)
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &ch.UserID, ActorRole: string(dbgen.UserRoleAdmin),
		Action: audit.ActionAdminLoginSucceeded, EntityType: "user", EntityID: ch.UserID.String(),
		Metadata: map[string]any{"method": method, "sessionId": tokens.SessionID},
	})
	p, err := s.Profile(ctx, ch.UserID)
	return tokens, p, recovery, err
}

func (s *Service) acceptTOTP(ctx context.Context, uid uuid.UUID, secret []byte, code string) bool {
	step, ok := VerifyTOTP(secret, code, s.now())
	if !ok {
		return false
	}
	fresh, err := s.MFA.AcceptTOTPStep(ctx, uid, step)
	return err == nil && fresh
}

func (s *Service) secondFactorFailed(ctx context.Context, mfaToken string, uid uuid.UUID, method string) error {
	_ = s.MFA.Fail(ctx, mfaToken)
	s.Audit.Log(ctx, audit.Entry{
		Action: audit.ActionTwoFactorFailed, EntityType: "user", EntityID: uid.String(),
		Metadata: map[string]any{"method": method},
	})
	return errInvalidSecondFactor()
}

// enableTOTP enregistre le secret chiffré et remplace les codes de secours, en une transaction.
func (s *Service) enableTOTP(ctx context.Context, uid uuid.UUID, secret []byte) ([]string, error) {
	codes := NewRecoveryCodes()
	rows := make([]dbgen.InsertRecoveryCodesParams, len(codes))
	for i, c := range codes {
		rows[i] = dbgen.InsertRecoveryCodesParams{UserID: uid, CodeHash: HashRecoveryCode(c)}
	}
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.EnableUserTOTP(ctx, dbgen.EnableUserTOTPParams{ID: uid, Secret: s.TOTPSealer.Seal(secret, uid[:])}); err != nil {
			return err
		}
		if err := q.DeleteRecoveryCodes(ctx, uid); err != nil {
			return err
		}
		_, err := q.InsertRecoveryCodes(ctx, rows)
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("auth: enable totp: %w", err)
	}
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &uid, ActorRole: string(dbgen.UserRoleAdmin),
		Action: audit.ActionTwoFactorEnabled, EntityType: "user", EntityID: uid.String(),
	})
	return codes, nil
}
