package middleware

import (
	"context"
	"net/http"
	"slices"
	"strings"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/auth"
	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/http/respond"
)

// HeaderCSRF porte le jeton CSRF des requêtes authentifiées par cookie (admin web).
const HeaderCSRF = "X-CSRF-Token"

// TokenVerifier vérifie un access token (*auth.TokenManager).
type TokenVerifier interface {
	Verify(token string) (*auth.Claims, error)
}

// SessionChecker vérifie qu'une session est active (*auth.SessionStore).
type SessionChecker interface {
	Exists(ctx context.Context, sid string) (bool, error)
}

// Authenticator authentifie les requêtes par « Authorization: Bearer » (mobile) ou par le
// cookie d'access token (admin web, avec contrôle CSRF sur les méthodes non sûres).
type Authenticator struct {
	tokens       TokenVerifier
	sessions     SessionChecker
	csrfKey      []byte
	accessCookie string
	rs           *respond.Responder
}

// NewAuthenticator construit l'authentificateur.
func NewAuthenticator(t TokenVerifier, s SessionChecker, csrfKey []byte, accessCookie string, rs *respond.Responder) *Authenticator {
	return &Authenticator{tokens: t, sessions: s, csrfKey: csrfKey, accessCookie: accessCookie, rs: rs}
}

func unauthorized(w http.ResponseWriter) *apperr.Error {
	w.Header().Set("WWW-Authenticate", `Bearer realm="gostation"`)
	return apperr.New(http.StatusUnauthorized, apperr.CodeUnauthorized, "Authentication is required.")
}

func safeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

func (a *Authenticator) principal(w http.ResponseWriter, r *http.Request) (httpctx.Principal, error) {
	var token string
	viaCookie := false
	if h := r.Header.Get("Authorization"); h != "" {
		scheme, value, ok := strings.Cut(h, " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") || value == "" {
			return httpctx.Principal{}, unauthorized(w)
		}
		token = strings.TrimSpace(value)
	} else if c, err := r.Cookie(a.accessCookie); err == nil && c.Value != "" {
		token, viaCookie = c.Value, true
	} else {
		return httpctx.Principal{}, unauthorized(w)
	}

	claims, err := a.tokens.Verify(token)
	if err != nil {
		return httpctx.Principal{}, unauthorized(w)
	}
	alive, err := a.sessions.Exists(r.Context(), claims.SID)
	if err != nil {
		return httpctx.Principal{}, apperr.Unavailable("Authentication is temporarily unavailable.").Wrap(err)
	}
	if !alive { // session révoquée (logout, changement de mot de passe, réutilisation détectée…)
		return httpctx.Principal{}, unauthorized(w)
	}
	if viaCookie && !safeMethod(r.Method) && !auth.ValidCSRF(a.csrfKey, claims.SID, r.Header.Get(HeaderCSRF)) {
		return httpctx.Principal{}, apperr.New(http.StatusForbidden, auth.CodeCSRFFailed, "Missing or invalid CSRF token.")
	}
	uid, _ := claims.UserID() // déjà validé par Verify
	return httpctx.Principal{UserID: uid, Role: claims.Role, SessionID: claims.SID, MFA: claims.MFA, ViaCookie: viaCookie}, nil
}

// Require exige une authentification valide.
func (a *Authenticator) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, err := a.principal(w, r)
		if err != nil {
			a.rs.Error(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(httpctx.WithPrincipal(r.Context(), p)))
	})
}

// Optional authentifie si des identifiants sont présents, sans les exiger (ex. logout).
// Des identifiants présents mais invalides sont ignorés.
func (a *Authenticator) Optional(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || hasCookie(r, a.accessCookie) {
			if p, err := a.principal(headerSink{w}, r); err == nil {
				r = r.WithContext(httpctx.WithPrincipal(r.Context(), p))
			}
		}
		next.ServeHTTP(w, r)
	})
}

func hasCookie(r *http.Request, name string) bool {
	c, err := r.Cookie(name)
	return err == nil && c.Value != ""
}

// headerSink absorbe les en-têtes (WWW-Authenticate) que principal poserait : Optional ne
// doit jamais modifier la réponse.
type headerSink struct{ http.ResponseWriter }

func (headerSink) Header() http.Header { return http.Header{} }

// RequireRole exige l'un des rôles. Un admin doit en plus avoir passé la 2FA (claim mfa).
func RequireRole(rs *respond.Responder, roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := httpctx.PrincipalFrom(r.Context())
			allowed := ok && slices.Contains(roles, p.Role) && (p.Role != "admin" || p.MFA)
			if !allowed {
				rs.Error(w, r, apperr.New(http.StatusForbidden, apperr.CodeForbidden, "You are not allowed to access this resource."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireCookieSession réserve une route à l'admin web : authentification par cookie de session,
// donc jeton CSRF exigé sur toute écriture. Un access token présenté en Bearer y est refusé.
func RequireCookieSession(rs *respond.Responder) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if p, ok := httpctx.PrincipalFrom(r.Context()); !ok || !p.ViaCookie {
				rs.Error(w, r, apperr.New(http.StatusForbidden, apperr.CodeForbidden, "Admin routes require the web session (cookie and CSRF token)."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// EmailVerifier lit l'état de vérification de l'email en base (*auth.Service).
type EmailVerifier interface {
	EmailVerified(ctx context.Context, uid uuid.UUID) (bool, error)
}

// RequireVerifiedEmail exige un email vérifié (signalements, favoris, notifications — D5).
// L'état est lu en base : il prend effet dès la vérification, sans attendre un nouveau token.
func RequireVerifiedEmail(rs *respond.Responder, v EmailVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := httpctx.PrincipalFrom(r.Context())
			if !ok {
				rs.Error(w, r, unauthorized(w))
				return
			}
			verified, err := v.EmailVerified(r.Context(), p.UserID)
			if err != nil {
				rs.Error(w, r, err)
				return
			}
			if !verified {
				rs.Error(w, r, apperr.New(http.StatusForbidden, auth.CodeEmailNotVerified, "Verify your email address to use this feature."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// StationStatusReader lit le statut de la station d'un gérant (*station.Service).
type StationStatusReader interface {
	ManagerStationStatus(ctx context.Context, managerID uuid.UUID) (string, error)
}

// RequireApprovedStation exige que la station du gérant soit approuvée.
func RequireApprovedStation(rs *respond.Responder, s StationStatusReader) func(http.Handler) http.Handler {
	return RequireStationStatus(rs, s, "approved")
}

// RequireStationStatus exige que la station du gérant ait l'un des statuts donnés, vérifié en base
// à chaque requête (une suspension prend effet immédiatement). Sert l'exception « rejected »
// (correction et renvoi du justificatif, D15). Le statut est renvoyé en extension pour que
// l'application affiche le bon écran.
func RequireStationStatus(rs *respond.Responder, s StationStatusReader, statuses ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := httpctx.PrincipalFrom(r.Context())
			if !ok {
				rs.Error(w, r, unauthorized(w))
				return
			}
			status, err := s.ManagerStationStatus(r.Context(), p.UserID)
			if err != nil {
				rs.Error(w, r, err)
				return
			}
			if !slices.Contains(statuses, status) {
				detail := "Your station has not been approved yet."
				if status == "suspended" {
					detail = "Your station is suspended."
				}
				rs.Error(w, r, apperr.New(http.StatusForbidden, auth.CodeStationNotApproved, detail).WithMeta("stationStatus", status))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
