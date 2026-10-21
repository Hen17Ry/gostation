// Package auth implémente l'authentification et les comptes : inscription (utilisateur et
// gérant), vérification de l'email, connexion, sessions à refresh tokens rotatifs, mots de
// passe, 2FA TOTP des admins, profil et suppression de compte.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/audit"
	"gostation/backend/internal/document"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/platform/crypto"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Config regroupe les réglages du service.
type Config struct {
	// PrivacyPolicyVersion est la version courante de la politique de confidentialité (D9).
	PrivacyPolicyVersion string
	RefreshTTL           time.Duration
	AdminRefreshTTL      time.Duration
}

// Deps regroupe les dépendances injectées.
type Deps struct {
	Store      *store.Store
	Sessions   *SessionStore
	OTPs       *OTPStore
	MFA        *MFAStore
	Tokens     *TokenManager
	Hasher     *PasswordHasher
	Policy     *PasswordPolicy
	Mailer     mail.Mailer
	Templates  *mail.Renderer
	Documents  *document.Service
	Audit      *audit.Logger
	TOTPSealer *crypto.Sealer
	// EmailKey sert aux empreintes HMAC des emails (audit, rate limiting) : jamais d'email en clair.
	EmailKey []byte
	Log      *slog.Logger
}

// Service orchestre les parcours d'authentification.
type Service struct {
	Deps
	cfg Config
	now func() time.Time
}

// NewService construit le service.
func NewService(cfg Config, d Deps) *Service {
	return &Service{Deps: d, cfg: cfg, now: time.Now}
}

// ClientMeta décrit le client à l'origine d'une session.
type ClientMeta struct {
	Client    string
	UserAgent string
}

// TokenPair est le résultat d'une connexion ou d'un renouvellement.
type TokenPair struct {
	AccessToken      string
	ExpiresIn        time.Duration
	RefreshToken     string
	RefreshExpiresIn time.Duration
	SessionID        string
}

// StationSummary résume la station d'un gérant (statut visible même non approuvée).
type StationSummary struct {
	ID           uuid.UUID
	Name         string
	Status       string
	StatusReason *string
}

// Profile est la vue « moi » d'un compte.
type Profile struct {
	ID                    uuid.UUID
	Email                 string
	FirstName             string
	LastName              string
	Role                  string
	EmailVerified         bool
	PrivacyAcceptedVer    string
	PrivacyAcceptedAt     time.Time
	CurrentPrivacyVersion string
	TwoFactorEnabled      bool
	CreatedAt             time.Time
	Station               *StationSummary
}

// ReacceptRequired indique que la politique de confidentialité a changé depuis l'acceptation.
func (p Profile) ReacceptRequired() bool { return p.PrivacyAcceptedVer != p.CurrentPrivacyVersion }

// EmailFingerprint renvoie l'empreinte HMAC d'un email normalisé (audit, clés de rate limit).
func EmailFingerprint(key []byte, email string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(strings.ToLower(strings.TrimSpace(email))))
	return hex.EncodeToString(m.Sum(nil))[:32]
}

func (s *Service) emailFP(email string) string { return EmailFingerprint(s.EmailKey, email) }

// openSession crée la session Redis et signe l'access token.
func (s *Service) openSession(ctx context.Context, uid uuid.UUID, role string, mfa bool, meta ClientMeta) (TokenPair, error) {
	// Admin : 12 h au plus depuis la connexion, même en activité (ASVS 3.3.2) ; utilisateurs et
	// gérants : durée glissante (l'app reste connectée tant qu'elle sert).
	ttl, maxAge := s.cfg.RefreshTTL, time.Duration(0)
	if role == string(dbgen.UserRoleAdmin) {
		ttl, maxAge = s.cfg.AdminRefreshTTL, s.cfg.AdminRefreshTTL
	}
	sess, refresh, err := s.Sessions.Create(ctx, Session{
		UserID: uid, Role: role, Client: meta.Client, UserAgent: meta.UserAgent, MFA: mfa, MaxAge: maxAge,
	}, ttl)
	if err != nil {
		return TokenPair{}, err
	}
	access, err := s.Tokens.Issue(uid, role, sess.ID, mfa)
	if err != nil {
		return TokenPair{}, err
	}
	return TokenPair{
		AccessToken: access, ExpiresIn: s.Tokens.TTL(),
		RefreshToken: refresh, RefreshExpiresIn: ttl, SessionID: sess.ID,
	}, nil
}

// Profile renvoie la vue « moi », avec la station pour un gérant.
func (s *Service) Profile(ctx context.Context, uid uuid.UUID) (Profile, error) {
	u, err := s.Store.GetUserByID(ctx, uid)
	if err != nil {
		return Profile{}, fmt.Errorf("auth: load profile: %w", store.Translate(err))
	}
	p := Profile{
		ID: u.ID, Email: u.Email, FirstName: u.FirstName, LastName: u.LastName, Role: string(u.Role),
		EmailVerified: u.EmailVerifiedAt != nil, PrivacyAcceptedVer: u.PrivacyPolicyVersion,
		PrivacyAcceptedAt: u.PrivacyAcceptedAt, CurrentPrivacyVersion: s.cfg.PrivacyPolicyVersion,
		TwoFactorEnabled: u.TotpEnabledAt != nil, CreatedAt: u.CreatedAt,
	}
	if u.Role == dbgen.UserRoleManager {
		st, err := s.Store.GetStationByManager(ctx, &uid)
		switch {
		case err == nil:
			p.Station = &StationSummary{ID: st.ID, Name: st.Name, Status: string(st.Status), StatusReason: st.StatusReason}
		case store.IsNotFound(err):
			// gérant sans station : pas de résumé
		default:
			return Profile{}, fmt.Errorf("auth: load manager station: %w", err)
		}
	}
	return p, nil
}

// sendEmail rend et met en file un email ; un échec est journalisé, jamais renvoyé au client
// (ce qui révélerait l'existence du compte).
func (s *Service) sendEmail(ctx context.Context, m mail.Message, err error) {
	if err == nil {
		err = s.Mailer.Send(ctx, m)
	}
	if err != nil {
		s.Log.ErrorContext(ctx, "auth: send email", slog.String("subject", m.Subject), slog.Any("err", err))
	}
}

func (s *Service) issueAndSend(ctx context.Context, p Purpose, uid uuid.UUID, email, firstName string) {
	code, err := s.OTPs.Issue(ctx, p, uid)
	if errors.Is(err, ErrResendTooSoon) || errors.Is(err, ErrResendExhausted) {
		s.Log.InfoContext(ctx, "auth: code not sent (resend limit)", slog.String("purpose", string(p)))
		return
	}
	if err != nil {
		s.Log.ErrorContext(ctx, "auth: issue code", slog.String("purpose", string(p)), slog.Any("err", err))
		return
	}
	var m mail.Message
	if p == PurposeVerifyEmail {
		m, err = s.Templates.VerifyEmail(email, firstName, code, OTPTTL)
	} else {
		m, err = s.Templates.ResetPassword(email, firstName, code, OTPTTL)
	}
	s.sendEmail(ctx, m, err)
}

func ptr[T any](v T) *T { return &v }
