package handler

import (
	"bytes"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"time"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/auth"
	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/http/middleware"
	"gostation/backend/internal/http/respond"
)

// Limites de débit de l'auth (docs/ARCHITECTURE.md §6).
const (
	loginLimit     = 5 // par minute, par IP et par email
	loginWindow    = time.Minute
	codeIPLimit    = 30 // vérifications de code (email, reset, 2FA) par IP
	codeIPWindow   = 10 * time.Minute
	emailIPLimit   = 20 // demandes d'envoi d'email (resend, forgot) par IP
	emailIPWindow  = time.Hour
	multipartField = 4 << 10 // taille max d'un champ texte multipart
)

// Cookies nomme et configure les cookies de session de l'admin web. Avec Secure, les préfixes
// __Host- / __Secure- empêchent un sous-domaine ou une connexion non chiffrée de les poser.
type Cookies struct {
	Secure bool
}

// Access est le cookie de l'access token (Path=/).
func (c Cookies) Access() string {
	if c.Secure {
		return "__Host-gs_at"
	}
	return "gs_at"
}

// Refresh est le cookie du refresh token, envoyé seulement aux routes /api/v1/auth.
func (c Cookies) Refresh() string {
	if c.Secure {
		return "__Secure-gs_rt"
	}
	return "gs_rt"
}

// CSRF est le cookie lisible par le JavaScript de l'admin web, à recopier dans X-CSRF-Token.
func (Cookies) CSRF() string { return "gs_csrf" }

// Auth sert les routes /api/v1/auth et /.well-known/jwks.json.
type Auth struct {
	rs       *respond.Responder
	svc      *auth.Service
	limiter  middleware.Limiter
	keys     *middleware.ClientKeys
	cookies  Cookies
	csrfKey  []byte
	emailKey []byte
	log      *slog.Logger
}

// NewAuth construit le handler.
func NewAuth(rs *respond.Responder, svc *auth.Service, l middleware.Limiter, keys *middleware.ClientKeys, c Cookies, csrfKey, emailKey []byte, log *slog.Logger) *Auth {
	return &Auth{rs: rs, svc: svc, limiter: l, keys: keys, cookies: c, csrfKey: csrfKey, emailKey: emailKey, log: log}
}

func clientMeta(r *http.Request, client string) auth.ClientMeta {
	return auth.ClientMeta{Client: client, UserAgent: r.UserAgent()}
}

// limit applique un quota ; refus → 429 avec Retry-After. Redis indisponible → 503 : ces routes
// (connexion, codes, emails) échouent fermées, sinon une panne de Redis ouvrirait l'essai de mots
// de passe sans limite, la vérification en base continuant de répondre (ASVS 2.2.1). Elles ne
// peuvent de toute façon pas aboutir sans Redis (sessions, codes).
func (h *Auth) limit(w http.ResponseWriter, r *http.Request, name, key string, n int, window time.Duration) error {
	if key == "" {
		return nil
	}
	res, err := h.limiter.Allow(r.Context(), name+":"+key, n, window)
	if err != nil {
		h.log.WarnContext(r.Context(), "auth rate limiter unavailable, request refused", slog.String("policy", name), slog.Any("err", err))
		return apperr.Unavailable("Service temporarily unavailable, retry later.").Wrap(err)
	}
	if !res.Allowed {
		w.Header().Set("Retry-After", strconv.Itoa(max(1, int(res.RetryAfter.Seconds()+0.999))))
		return apperr.TooManyRequests("Too many attempts, retry later.")
	}
	return nil
}

func (h *Auth) limitLogin(w http.ResponseWriter, r *http.Request, prefix, email string) error {
	if err := h.limit(w, r, prefix+"-ip", h.keys.ByClientIP(r), loginLimit, loginWindow); err != nil {
		return err
	}
	return h.limit(w, r, prefix+"-email", auth.EmailFingerprint(h.emailKey, email), loginLimit, loginWindow)
}

// ── DTO ─────────────────────────────────────────────────────────────────────

type privacyDTO struct {
	AcceptedVersion  string    `json:"acceptedVersion"`
	AcceptedAt       time.Time `json:"acceptedAt"`
	CurrentVersion   string    `json:"currentVersion"`
	ReacceptRequired bool      `json:"reacceptRequired"`
}

type stationSummaryDTO struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Status       string  `json:"status"`
	StatusReason *string `json:"statusReason"`
}

type profileDTO struct {
	ID               string             `json:"id"`
	Email            string             `json:"email"`
	FirstName        string             `json:"firstName"`
	LastName         string             `json:"lastName"`
	Role             string             `json:"role"`
	EmailVerified    bool               `json:"emailVerified"`
	TwoFactorEnabled bool               `json:"twoFactorEnabled"`
	PrivacyPolicy    privacyDTO         `json:"privacyPolicy"`
	Station          *stationSummaryDTO `json:"station"`
	CreatedAt        time.Time          `json:"createdAt"`
}

func toProfileDTO(p auth.Profile) profileDTO {
	d := profileDTO{
		ID: p.ID.String(), Email: p.Email, FirstName: p.FirstName, LastName: p.LastName, Role: p.Role,
		EmailVerified: p.EmailVerified, TwoFactorEnabled: p.TwoFactorEnabled, CreatedAt: p.CreatedAt,
		PrivacyPolicy: privacyDTO{
			AcceptedVersion: p.PrivacyAcceptedVer, AcceptedAt: p.PrivacyAcceptedAt,
			CurrentVersion: p.CurrentPrivacyVersion, ReacceptRequired: p.ReacceptRequired(),
		},
	}
	if p.Station != nil {
		d.Station = &stationSummaryDTO{
			ID: p.Station.ID.String(), Name: p.Station.Name,
			Status: p.Station.Status, StatusReason: p.Station.StatusReason,
		}
	}
	return d
}

type tokensDTO struct {
	AccessToken      string `json:"accessToken"`
	TokenType        string `json:"tokenType"`
	ExpiresIn        int    `json:"expiresIn"`
	RefreshToken     string `json:"refreshToken"`
	RefreshExpiresIn int    `json:"refreshExpiresIn"`
}

type sessionResponse struct {
	tokensDTO
	User profileDTO `json:"user"`
}

func toTokensDTO(t auth.TokenPair) tokensDTO {
	return tokensDTO{
		AccessToken: t.AccessToken, TokenType: "Bearer", ExpiresIn: int(t.ExpiresIn.Seconds()),
		RefreshToken: t.RefreshToken, RefreshExpiresIn: int(t.RefreshExpiresIn.Seconds()),
	}
}

func (h *Auth) writeSession(w http.ResponseWriter, r *http.Request, status int, t auth.TokenPair, p auth.Profile) {
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, status, sessionResponse{tokensDTO: toTokensDTO(t), User: toProfileDTO(p)})
}

type acceptedResponse struct {
	Status string `json:"status"`
}

// ── Cookies de l'admin web ──────────────────────────────────────────────────

// cookie construit un cookie de session de l'admin web : SameSite=Strict toujours, Secure piloté
// par COOKIE_SECURE (imposé à true en production par la validation de la configuration).
func (h *Auth) cookie(name, value, path string, maxAge int, httpOnly bool) *http.Cookie {
	return &http.Cookie{ //nolint:gosec // G124 : Secure vient de la config ; le cookie CSRF est non HttpOnly par conception
		Name: name, Value: value, Path: path, MaxAge: maxAge,
		HttpOnly: httpOnly, Secure: h.cookies.Secure, SameSite: http.SameSiteStrictMode,
	}
}

func (h *Auth) setSessionCookies(w http.ResponseWriter, t auth.TokenPair) string {
	csrf := auth.CSRFToken(h.csrfKey, t.SessionID)
	http.SetCookie(w, h.cookie(h.cookies.Access(), t.AccessToken, "/", int(t.ExpiresIn.Seconds()), true))
	http.SetCookie(w, h.cookie(h.cookies.Refresh(), t.RefreshToken, "/api/v1/auth", int(t.RefreshExpiresIn.Seconds()), true))
	// Lisible par le JavaScript de l'admin web (double soumission dans X-CSRF-Token) : c'est voulu.
	http.SetCookie(w, h.cookie(h.cookies.CSRF(), csrf, "/", int(t.RefreshExpiresIn.Seconds()), false))
	return csrf
}

func (h *Auth) clearSessionCookies(w http.ResponseWriter) {
	http.SetCookie(w, h.cookie(h.cookies.Access(), "", "/", -1, true))
	http.SetCookie(w, h.cookie(h.cookies.Refresh(), "", "/api/v1/auth", -1, true))
	http.SetCookie(w, h.cookie(h.cookies.CSRF(), "", "/", -1, false))
}

type adminSessionResponse struct {
	User          profileDTO `json:"user"`
	CSRFToken     string     `json:"csrfToken"`
	ExpiresIn     int        `json:"expiresIn"`
	RecoveryCodes []string   `json:"recoveryCodes,omitempty"`
}

// ── Inscription ─────────────────────────────────────────────────────────────

type registerRequest struct {
	FirstName            string `json:"firstName"`
	LastName             string `json:"lastName"`
	Email                string `json:"email"`
	Password             string `json:"password"`
	PrivacyPolicyVersion string `json:"privacyPolicyVersion"`
}

// Register crée un compte utilisateur (POST /auth/register).
func (h *Auth) Register(w http.ResponseWriter, r *http.Request) error {
	var req registerRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	t, p, err := h.svc.RegisterUser(r.Context(), auth.AccountInput(req), clientMeta(r, auth.ClientMobile))
	if err != nil {
		return err
	}
	h.writeSession(w, r, http.StatusCreated, t, p)
	return nil
}

// managerFields sont les champs texte acceptés par POST /auth/register/manager.
var managerFields = map[string]bool{
	"firstName": true, "lastName": true, "email": true, "password": true, "privacyPolicyVersion": true,
	"stationName": true, "brand": true, "ifu": true, "rccm": true, "address": true, "city": true, "phone": true,
}

// RegisterManager crée un compte gérant et sa station (POST /auth/register/manager, multipart).
// Lecture en flux : le justificatif reste en mémoire (borné), jamais en fichier temporaire.
func (h *Auth) RegisterManager(w http.ResponseWriter, r *http.Request) error {
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "multipart/form-data" {
		return apperr.New(http.StatusUnsupportedMediaType, apperr.CodeInvalidParameter, "Content-Type must be multipart/form-data.")
	}
	mr, err := r.MultipartReader()
	if err != nil {
		return apperr.BadRequest(apperr.CodeInvalidParameter, "Malformed multipart body.").Wrap(err)
	}
	fields := map[string]string{}
	var doc []byte
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			var maxBytes *http.MaxBytesError
			if errors.As(err, &maxBytes) {
				return err
			}
			return apperr.BadRequest(apperr.CodeInvalidParameter, "Malformed multipart body.").Wrap(err)
		}
		name := part.FormName()
		switch {
		case name == "document":
			if doc != nil {
				return apperr.Validation(apperr.FieldError{Field: "document", Code: "duplicate", Message: "must be sent once"})
			}
			// Le service applique la limite de 5 Mo (lecture bornée à limite + 1 octet).
			if doc, err = io.ReadAll(part); err != nil {
				return err
			}
		case managerFields[name]:
			v, err := io.ReadAll(io.LimitReader(part, multipartField+1))
			if err != nil {
				return err
			}
			if len(v) > multipartField {
				return apperr.Validation(apperr.FieldError{Field: name, Code: "too_long", Message: "is too long"})
			}
			fields[name] = string(v)
		default:
			return apperr.Validation(apperr.FieldError{Field: name, Code: "unknown_field", Message: "is not a known field"})
		}
	}
	var docReader io.Reader
	if doc != nil {
		docReader = bytes.NewReader(doc)
	}
	t, p, err := h.svc.RegisterManager(r.Context(),
		auth.AccountInput{
			FirstName: fields["firstName"], LastName: fields["lastName"], Email: fields["email"],
			Password: fields["password"], PrivacyPolicyVersion: fields["privacyPolicyVersion"],
		},
		auth.StationInput{
			Name: fields["stationName"], Brand: fields["brand"], IFU: fields["ifu"], RCCM: fields["rccm"],
			Address: fields["address"], City: fields["city"], Phone: fields["phone"],
		},
		docReader, clientMeta(r, auth.ClientMobile))
	if err != nil {
		return err
	}
	h.writeSession(w, r, http.StatusCreated, t, p)
	return nil
}

// ── Codes par email ─────────────────────────────────────────────────────────

type emailRequest struct {
	Email string `json:"email"`
}

type verifyEmailRequest struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

// VerifyEmail consomme le code de vérification (POST /auth/verify-email).
func (h *Auth) VerifyEmail(w http.ResponseWriter, r *http.Request) error {
	var req verifyEmailRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	if err := h.limit(w, r, "code-ip", h.keys.ByClientIP(r), codeIPLimit, codeIPWindow); err != nil {
		return err
	}
	if err := h.svc.VerifyEmail(r.Context(), req.Email, req.Code); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *Auth) acceptEmailRequest(w http.ResponseWriter, r *http.Request, do func(email string) error) error {
	var req emailRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	if err := h.limit(w, r, "email-ip", h.keys.ByClientIP(r), emailIPLimit, emailIPWindow); err != nil {
		return err
	}
	if err := do(req.Email); err != nil {
		return err
	}
	// Réponse identique que le compte existe ou non (anti-énumération).
	h.rs.JSON(w, r, http.StatusAccepted, acceptedResponse{Status: "accepted"})
	return nil
}

// ResendVerification renvoie le code de vérification (POST /auth/resend-verification).
func (h *Auth) ResendVerification(w http.ResponseWriter, r *http.Request) error {
	return h.acceptEmailRequest(w, r, func(email string) error { return h.svc.ResendVerification(r.Context(), email) })
}

// ForgotPassword envoie un code de réinitialisation (POST /auth/password/forgot).
func (h *Auth) ForgotPassword(w http.ResponseWriter, r *http.Request) error {
	return h.acceptEmailRequest(w, r, func(email string) error { return h.svc.ForgotPassword(r.Context(), email) })
}

type resetPasswordRequest struct {
	Email       string `json:"email"`
	Code        string `json:"code"`
	NewPassword string `json:"newPassword"`
}

// ResetPassword change le mot de passe avec un code (POST /auth/password/reset).
func (h *Auth) ResetPassword(w http.ResponseWriter, r *http.Request) error {
	var req resetPasswordRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	if err := h.limit(w, r, "code-ip", h.keys.ByClientIP(r), codeIPLimit, codeIPWindow); err != nil {
		return err
	}
	if err := h.svc.ResetPassword(r.Context(), req.Email, req.Code, req.NewPassword); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ── Connexion et sessions ───────────────────────────────────────────────────

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Login connecte un utilisateur ou un gérant (POST /auth/login).
func (h *Auth) Login(w http.ResponseWriter, r *http.Request) error {
	var req loginRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	if err := h.limitLogin(w, r, "login", req.Email); err != nil {
		return err
	}
	t, p, err := h.svc.Login(r.Context(), req.Email, req.Password, clientMeta(r, auth.ClientMobile))
	if err != nil {
		return err
	}
	h.writeSession(w, r, http.StatusOK, t, p)
	return nil
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

// Refresh fait tourner le refresh token (POST /auth/refresh) : dans le corps pour le mobile,
// dans le cookie (avec contrôle CSRF) pour l'admin web.
func (h *Auth) Refresh(w http.ResponseWriter, r *http.Request) error {
	var req refreshRequest
	if err := decodeJSON(r, &req, true); err != nil {
		return err
	}
	if req.RefreshToken != "" {
		t, _, err := h.svc.Refresh(r.Context(), req.RefreshToken)
		if err != nil {
			return err
		}
		w.Header().Set("Cache-Control", "no-store")
		h.rs.JSON(w, r, http.StatusOK, toTokensDTO(t))
		return nil
	}

	c, err := r.Cookie(h.cookies.Refresh())
	if err != nil || c.Value == "" {
		return apperr.New(http.StatusUnauthorized, auth.CodeInvalidRefreshToken, "Missing refresh token.")
	}
	if err := h.checkCookieCSRF(r, c.Value); err != nil {
		return err
	}
	t, _, err := h.svc.Refresh(r.Context(), c.Value)
	if err != nil {
		h.clearSessionCookies(w)
		return err
	}
	csrf := h.setSessionCookies(w, t)
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, map[string]any{"csrfToken": csrf, "expiresIn": int(t.ExpiresIn.Seconds())})
	return nil
}

// CSRF renvoie le jeton CSRF de la session web (GET /auth/csrf). Après un rechargement de page,
// le client admin le récupère sans dépendre d'un cookie lisible (api.<domaine> et admin.<domaine>
// sont deux hôtes, D43) ni d'un stockage local. Session identifiée par le cookie d'accès, sinon par
// le cookie de refresh (sans rotation : l'appel peut précéder un refresh). Une lecture n'a pas
// besoin de jeton : la politique CORS empêche un autre site de lire la réponse.
func (h *Auth) CSRF(w http.ResponseWriter, r *http.Request) error {
	var sid string
	if p, ok := httpctx.PrincipalFrom(r.Context()); ok && p.ViaCookie {
		sid = p.SessionID
	} else if c, err := r.Cookie(h.cookies.Refresh()); err == nil && c.Value != "" {
		if sess, err := h.svc.SessionForRefreshToken(r.Context(), c.Value); err == nil && sess.Client == auth.ClientWeb {
			sid = sess.ID
		}
	}
	if sid == "" {
		return apperr.New(http.StatusUnauthorized, apperr.CodeUnauthorized, "No web session.")
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, csrfResponse{CSRFToken: auth.CSRFToken(h.csrfKey, sid)})
	return nil
}

type csrfResponse struct {
	CSRFToken string `json:"csrfToken"`
}

// checkCookieCSRF vérifie le jeton CSRF d'une requête qui s'appuie sur le cookie de refresh.
func (h *Auth) checkCookieCSRF(r *http.Request, refreshToken string) error {
	sess, err := h.svc.SessionForRefreshToken(r.Context(), refreshToken)
	if err != nil {
		return apperr.New(http.StatusUnauthorized, auth.CodeInvalidRefreshToken, "Invalid or expired refresh token.").Wrap(err)
	}
	if !auth.ValidCSRF(h.csrfKey, sess.ID, r.Header.Get(middleware.HeaderCSRF)) {
		return apperr.New(http.StatusForbidden, auth.CodeCSRFFailed, "Missing or invalid CSRF token.")
	}
	return nil
}

// Logout révoque la session courante (POST /auth/logout) : identifiée par l'access token si
// présent, sinon par le refresh token (corps ou cookie). Toujours 204.
func (h *Auth) Logout(w http.ResponseWriter, r *http.Request) error {
	var req refreshRequest
	if err := decodeJSON(r, &req, true); err != nil {
		return err
	}
	switch p, ok := httpctx.PrincipalFrom(r.Context()); {
	case ok:
		if err := h.svc.Logout(r.Context(), p.UserID, p.Role, p.SessionID); err != nil {
			return err
		}
	case req.RefreshToken != "":
		if err := h.svc.LogoutByRefreshToken(r.Context(), req.RefreshToken); err != nil {
			return err
		}
	default:
		if c, err := r.Cookie(h.cookies.Refresh()); err == nil && c.Value != "" {
			if err := h.checkCookieCSRF(r, c.Value); err == nil {
				if err := h.svc.LogoutByRefreshToken(r.Context(), c.Value); err != nil {
					return err
				}
			}
		}
	}
	h.clearSessionCookies(w)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// LogoutAll révoque toutes les sessions de l'utilisateur (POST /auth/logout-all).
func (h *Auth) LogoutAll(w http.ResponseWriter, r *http.Request) error {
	p, _ := httpctx.PrincipalFrom(r.Context())
	if err := h.svc.LogoutAll(r.Context(), p.UserID, p.Role); err != nil {
		return err
	}
	h.clearSessionCookies(w)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ── Admin : mot de passe puis 2FA ───────────────────────────────────────────

type adminChallengeResponse struct {
	MFAToken  string        `json:"mfaToken"`
	TwoFactor string        `json:"twoFactor"`
	Setup     *totpSetupDTO `json:"setup,omitempty"`
	ExpiresIn int           `json:"expiresIn"`
}

type totpSetupDTO struct {
	Secret     string `json:"secret"`
	OTPAuthURI string `json:"otpauthUri"`
}

// AdminLogin vérifie le mot de passe d'un admin et ouvre le défi 2FA (POST /auth/admin/login).
func (h *Auth) AdminLogin(w http.ResponseWriter, r *http.Request) error {
	var req loginRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	if err := h.limitLogin(w, r, "admin-login", req.Email); err != nil {
		return err
	}
	ch, err := h.svc.AdminLogin(r.Context(), req.Email, req.Password)
	if err != nil {
		return err
	}
	resp := adminChallengeResponse{MFAToken: ch.MFAToken, TwoFactor: "required", ExpiresIn: int(auth.MFATokenTTL.Seconds())}
	if ch.SetupRequired {
		resp.TwoFactor = "setup_required"
		resp.Setup = &totpSetupDTO{Secret: ch.Secret, OTPAuthURI: ch.URI}
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, resp)
	return nil
}

type adminSecondFactorRequest struct {
	MFAToken     string `json:"mfaToken"`
	Code         string `json:"code"`
	RecoveryCode string `json:"recoveryCode"`
}

// AdminSecondFactor termine le login admin (POST /auth/admin/2fa) : code TOTP (mise en place
// ou vérification) ou code de secours. Pose les cookies de session.
func (h *Auth) AdminSecondFactor(w http.ResponseWriter, r *http.Request) error {
	var req adminSecondFactorRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	if req.MFAToken == "" || (req.Code == "") == (req.RecoveryCode == "") {
		return apperr.Validation(apperr.FieldError{
			Field: "code", Code: "required",
			Message: "mfaToken and exactly one of code or recoveryCode are required",
		})
	}
	if err := h.limit(w, r, "code-ip", h.keys.ByClientIP(r), codeIPLimit, codeIPWindow); err != nil {
		return err
	}
	t, p, recovery, err := h.svc.AdminSecondFactor(r.Context(), req.MFAToken, req.Code, req.RecoveryCode, clientMeta(r, auth.ClientWeb))
	if err != nil {
		return err
	}
	csrf := h.setSessionCookies(w, t)
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, adminSessionResponse{
		User: toProfileDTO(p), CSRFToken: csrf,
		ExpiresIn: int(t.ExpiresIn.Seconds()), RecoveryCodes: recovery,
	})
	return nil
}

// JWKS publie les clés publiques de vérification des access tokens (GET /.well-known/jwks.json).
func (h *Auth) JWKS(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Cache-Control", "public, max-age=300")
	h.rs.JSON(w, r, http.StatusOK, map[string]any{"keys": h.svc.Tokens.JWKS()})
	return nil
}
