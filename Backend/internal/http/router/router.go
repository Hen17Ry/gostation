// Package router assemble le routeur chi : middlewares globaux, sondes de santé et API /api/v1.
// La liste des routes doit rester identique à Backend/api/openapi.yaml (vérifié par un test).
package router

import (
	"log/slog"
	"net/http"
	"net/netip"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/handler"
	"gostation/backend/internal/http/middleware"
	"gostation/backend/internal/http/respond"
)

// Config regroupe les réglages HTTP du routeur.
type Config struct {
	RequestTimeout time.Duration
	// MaxBodyBytes borne les corps JSON ; DocumentBodyBytes l'inscription gérant (multipart).
	MaxBodyBytes       int64
	DocumentBodyBytes  int64
	TrustedProxies     []netip.Prefix
	CORSAllowedOrigins []string
	IPRateLimit        int
	IPRateWindow       time.Duration
}

// Deps regroupe les dépendances injectées. Les groupes auth, me, manager et admin ne sont
// montés que si leurs handlers sont fournis (tests unitaires du socle).
type Deps struct {
	Log           *slog.Logger
	Responder     *respond.Responder
	Health        *handler.Health
	Products      handler.ProductLister
	Limiter       middleware.Limiter
	Authenticator *middleware.Authenticator
	Auth          *handler.Auth
	Me            *handler.Me
	Stations      *handler.Stations
	EmailVerifier middleware.EmailVerifier
	StationStatus middleware.StationStatusReader
}

// Rôles (valeurs de l'enum user_role).
const (
	roleManager = "manager"
	roleAdmin   = "admin"
)

// Limite des inscriptions : 10 par heure et par IP.
const (
	registerLimit  = 10
	registerWindow = time.Hour
)

// New construit le handler HTTP de l'API.
func New(cfg Config, d Deps) http.Handler {
	rs := d.Responder
	h := func(fn handler.Func) http.HandlerFunc { return handler.Handle(rs, fn) }
	r := chi.NewRouter()

	// Ordre : l'identifiant et l'IP d'abord, puis le journal (qui voit le statut final),
	// puis recover (dont le 500 est journalisé).
	r.Use(
		middleware.RequestID,
		middleware.RealIP(cfg.TrustedProxies),
		middleware.AccessLog(d.Log),
		middleware.Recover(d.Log, rs),
	)
	if len(cfg.CORSAllowedOrigins) > 0 {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins: cfg.CORSAllowedOrigins,
			AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions},
			AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", middleware.HeaderRequestID, middleware.HeaderCSRF},
			ExposedHeaders: []string{middleware.HeaderRequestID, "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"},
			// Les cookies de session de l'admin web exigent les credentials.
			AllowCredentials: true,
			MaxAge:           300,
		}))
	}

	r.NotFound(h(func(_ http.ResponseWriter, req *http.Request) error {
		return apperr.New(http.StatusNotFound, apperr.CodeRouteNotFound, "No route matches "+req.Method+" "+req.URL.Path+".")
	}))
	r.MethodNotAllowed(h(func(_ http.ResponseWriter, req *http.Request) error {
		return apperr.New(http.StatusMethodNotAllowed, apperr.CodeMethodNotAllowed, "Method "+req.Method+" is not allowed on "+req.URL.Path+".")
	}))

	r.Get("/healthz", h(d.Health.Live))
	r.Get("/readyz", h(d.Health.Ready))
	if d.Auth != nil {
		r.Get("/.well-known/jwks.json", h(d.Auth.JWKS))
	}

	products := handler.NewProducts(rs, d.Products)
	registerRL := middleware.RateLimit(d.Limiter, middleware.RateLimitPolicy{
		Name: "register", Limit: registerLimit, Window: registerWindow, Key: middleware.ByClientIP,
	}, d.Log, rs)

	r.Route("/api/v1", func(api chi.Router) {
		api.Use(
			middleware.Timeout(cfg.RequestTimeout),
			chimw.Compress(5, "application/json", respond.ContentTypeProblem),
			middleware.RateLimit(d.Limiter, middleware.RateLimitPolicy{
				Name: "ip", Limit: cfg.IPRateLimit, Window: cfg.IPRateWindow, Key: middleware.ByClientIP,
			}, d.Log, rs),
		)

		// Inscription gérant : multipart avec justificatif, limite de corps dédiée.
		if d.Auth != nil {
			api.With(middleware.MaxBodyBytes(cfg.DocumentBodyBytes, rs), registerRL).
				Post("/auth/register/manager", h(d.Auth.RegisterManager))
		}

		api.Group(func(j chi.Router) {
			j.Use(middleware.MaxBodyBytes(cfg.MaxBodyBytes, rs))
			j.Get("/products", h(products.List))

			if d.Auth == nil {
				return
			}
			a := d.Auth
			j.With(registerRL).Post("/auth/register", h(a.Register))
			j.Post("/auth/verify-email", h(a.VerifyEmail))
			j.Post("/auth/resend-verification", h(a.ResendVerification))
			j.Post("/auth/login", h(a.Login))
			j.Post("/auth/refresh", h(a.Refresh))
			j.With(d.Authenticator.Optional).Post("/auth/logout", h(a.Logout))
			j.With(d.Authenticator.Require).Post("/auth/logout-all", h(a.LogoutAll))
			j.Post("/auth/password/forgot", h(a.ForgotPassword))
			j.Post("/auth/password/reset", h(a.ResetPassword))
			j.Post("/auth/admin/login", h(a.AdminLogin))
			j.Post("/auth/admin/2fa", h(a.AdminSecondFactor))

			j.Group(func(me chi.Router) {
				me.Use(d.Authenticator.Require)
				me.Get("/me", h(d.Me.Get))
				me.Patch("/me", h(d.Me.Update))
				me.Delete("/me", h(d.Me.Delete))
				me.Post("/me/change-password", h(d.Me.ChangePassword))
				me.Post("/me/accept-privacy-policy", h(d.Me.AcceptPrivacyPolicy))
				me.Get("/me/sessions", h(d.Me.Sessions))
				me.Delete("/me/sessions/{id}", h(d.Me.RevokeSession))
			})

			// Gérant : rien d'autre que /me tant que la station n'est pas approuvée.
			j.Group(func(m chi.Router) {
				m.Use(d.Authenticator.Require, middleware.RequireRole(rs, roleManager),
					middleware.RequireApprovedStation(rs, d.StationStatus))
				m.Get("/manager/station", h(d.Stations.ManagerStation))
			})

			// Admin : session ouverte après 2FA uniquement (RequireRole vérifie le claim mfa).
			j.Group(func(ad chi.Router) {
				ad.Use(d.Authenticator.Require, middleware.RequireRole(rs, roleAdmin))
				ad.Get("/admin/stations/{id}/document", h(d.Stations.AdminDocument))
			})
		})
	})

	return r
}
