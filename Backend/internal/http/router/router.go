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
	// Quotas de la recherche et de l'itinéraire, par minute (D22) : par IP, et par installation
	// (X-Install-Id) ou utilisateur connecté.
	SearchIPLimit     int
	SearchClientLimit int
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
	Search        *handler.Search
	Notifications *handler.Notifications
	Favorites     *handler.Favorites
	Reports       *handler.Reports
	Reminders     *handler.Reminders
	Admin         *handler.Admin
	EmailVerifier middleware.EmailVerifier
	StationStatus middleware.StationStatusReader
}

// Rôles (valeurs de l'enum user_role) et statuts de station (enum station_status).
const (
	roleManager     = "manager"
	roleAdmin       = "admin"
	stationApproved = "approved"
	stationRejected = "rejected"
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
			AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "If-Match", middleware.HeaderRequestID, middleware.HeaderCSRF, middleware.HeaderInstallID},
			ExposedHeaders: []string{"ETag", middleware.HeaderRequestID, "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After", "X-Cache", "Server-Timing"},
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
			chimw.Compress(5, "application/json", respond.ContentTypeProblem, respond.ContentTypeGeoJSON, "text/csv"),
			middleware.RateLimit(d.Limiter, middleware.RateLimitPolicy{
				Name: "ip", Limit: cfg.IPRateLimit, Window: cfg.IPRateWindow, Key: middleware.ByClientIP,
			}, d.Log, rs),
		)

		// Inscription gérant et renvoi du justificatif : multipart, limite de corps dédiée.
		if d.Auth != nil {
			api.With(middleware.MaxBodyBytes(cfg.DocumentBodyBytes, rs), registerRL).
				Post("/auth/register/manager", h(d.Auth.RegisterManager))
			api.With(middleware.MaxBodyBytes(cfg.DocumentBodyBytes, rs), d.Authenticator.Require,
				middleware.RequireRole(rs, roleManager), middleware.RequireStationStatus(rs, d.StationStatus, stationRejected)).
				Post("/manager/station/resubmission", h(d.Stations.Resubmit))
		}

		api.Group(func(j chi.Router) {
			j.Use(middleware.MaxBodyBytes(cfg.MaxBodyBytes, rs))
			j.Get("/products", h(products.List))

			// Recherche publique : connexion facultative (le quota suit alors l'utilisateur).
			if d.Search != nil {
				j.Group(func(sr chi.Router) {
					if d.Authenticator != nil {
						sr.Use(d.Authenticator.Optional)
					}
					sr.Use(
						middleware.RateLimit(d.Limiter, middleware.RateLimitPolicy{
							Name: "search-ip", Limit: cfg.SearchIPLimit, Window: time.Minute, Key: middleware.ByClientIP,
						}, d.Log, rs),
						middleware.RateLimit(d.Limiter, middleware.RateLimitPolicy{
							Name: "search-client", Limit: cfg.SearchClientLimit, Window: time.Minute, Key: middleware.ByInstallOrUser,
						}, d.Log, rs),
					)
					sr.Get("/search", h(d.Search.Search))
					sr.Get("/routes", h(d.Search.Route))
				})
				j.Get("/stations/{id}", h(d.Search.Station))
			}

			if d.Auth == nil {
				return
			}
			a := d.Auth
			j.With(registerRL).Post("/auth/register", h(a.Register))
			j.Post("/auth/verify-email", h(a.VerifyEmail))
			j.Post("/auth/resend-verification", h(a.ResendVerification))
			j.Post("/auth/login", h(a.Login))
			j.Post("/auth/refresh", h(a.Refresh))
			j.With(d.Authenticator.Optional).Get("/auth/csrf", h(a.CSRF))
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
				// Désenregistrer un appareil reste possible sans email vérifié.
				me.Delete("/me/devices/{id}", h(d.Notifications.UnregisterDevice))
			})

			// Notifications, favoris et signalements : email vérifié obligatoire (D5).
			j.Group(func(v chi.Router) {
				v.Use(d.Authenticator.Require, middleware.RequireVerifiedEmail(rs, d.EmailVerifier))
				v.Post("/me/devices", h(d.Notifications.RegisterDevice))
				v.Get("/me/notifications", h(d.Notifications.Inbox))
				v.Post("/me/notifications/read", h(d.Notifications.MarkRead))
				v.Get("/me/notification-settings", h(d.Notifications.Settings))
				v.Put("/me/notification-settings", h(d.Notifications.UpdateSettings))
				v.Get("/me/favorites", h(d.Favorites.List))
				v.Post("/me/favorites/{stationId}", h(d.Favorites.Add))
				v.Delete("/me/favorites/{stationId}", h(d.Favorites.Remove))
				v.Post("/stations/{id}/reports", h(d.Reports.Create))
			})

			// Gérant : rien d'autre que /me tant que la station n'est pas approuvée, sauf l'exception
			// « rejected » (consulter et corriger la station, renvoyer un justificatif — D15).
			st := d.Stations
			j.Group(func(m chi.Router) {
				m.Use(d.Authenticator.Require, middleware.RequireRole(rs, roleManager))
				m.Group(func(fix chi.Router) {
					fix.Use(middleware.RequireStationStatus(rs, d.StationStatus, stationApproved, stationRejected))
					fix.Get("/manager/station", h(st.ManagerStation))
					fix.Patch("/manager/station", h(st.UpdateStation))
				})
				m.Group(func(ok chi.Router) {
					ok.Use(middleware.RequireApprovedStation(rs, d.StationStatus))
					ok.Put("/manager/station/location", h(st.SetLocation))
					ok.Get("/manager/station/opening-hours", h(st.Hours))
					ok.Put("/manager/station/opening-hours", h(st.ReplaceHours))
					ok.Post("/manager/station/closures", h(st.AddClosure))
					ok.Delete("/manager/station/closures/{id}", h(st.DeleteClosure))
					ok.Get("/manager/station/products", h(st.Products))
					ok.Put("/manager/station/products", h(st.SetProducts))
					ok.Get("/manager/station/stocks", h(st.Stocks))
					ok.Put("/manager/station/stocks", h(st.UpdateStocks))
					ok.Post("/manager/station/stocks/confirm", h(st.ConfirmStocks))
					ok.Get("/manager/reports", h(d.Reports.ManagerList))
					ok.Post("/manager/reminders/mute", h(d.Reminders.Mute))
				})
			})

			// Admin : session web ouverte après 2FA uniquement (RequireRole vérifie le claim mfa),
			// authentifiée par cookie, donc jeton CSRF exigé sur toute écriture.
			adm := d.Admin
			j.Group(func(ad chi.Router) {
				ad.Use(d.Authenticator.Require, middleware.RequireRole(rs, roleAdmin), middleware.RequireCookieSession(rs))
				ad.Get("/admin/dashboard", h(adm.Dashboard))
				ad.Get("/admin/stats/searches", h(adm.SearchStats))
				ad.Get("/admin/stats/shortages", h(adm.Shortages))
				ad.Get("/admin/stations", h(st.AdminList))
				ad.Get("/admin/stations/map", h(st.AdminMap))
				ad.Get("/admin/stations/{id}", h(st.AdminDetail))
				ad.Patch("/admin/stations/{id}", h(st.AdminUpdate))
				ad.Get("/admin/stations/{id}/document", h(st.AdminDocument))
				ad.Post("/admin/stations/{id}/approve", h(st.Approve()))
				ad.Post("/admin/stations/{id}/reject", h(st.Reject()))
				ad.Post("/admin/stations/{id}/suspend", h(st.Suspend()))
				ad.Post("/admin/stations/{id}/unsuspend", h(st.Unsuspend()))
				ad.Post("/admin/stations/{id}/location-requests/{requestId}/approve", h(st.ApproveMove()))
				ad.Post("/admin/stations/{id}/location-requests/{requestId}/reject", h(st.RejectMove()))
				ad.Post("/admin/stations/{id}/location-flag/dismiss", h(st.DismissLocationFlag))
				ad.Get("/admin/reports", h(d.Reports.AdminList))
				ad.Post("/admin/reports/{id}/resolve", h(d.Reports.Resolve))
				ad.Post("/admin/reports/{id}/dismiss", h(d.Reports.Dismiss))
				ad.Get("/admin/alerts", h(d.Reports.Alerts))
				ad.Post("/admin/alerts/{id}/resolve", h(d.Reports.ResolveAlert))
				ad.Get("/admin/users", h(adm.Users))
				ad.Get("/admin/users/{id}", h(adm.User))
				ad.Post("/admin/users/{id}/disable", h(adm.DisableUser))
				ad.Post("/admin/users/{id}/reactivate", h(adm.ReactivateUser))
				ad.Post("/admin/users/{id}/resend-verification", h(adm.ResendVerification))
				ad.Post("/admin/users/{id}/reporting-ban", h(d.Reports.Ban))
				ad.Post("/admin/users/{id}/reporting-ban/lift", h(d.Reports.Unban))
				ad.Get("/admin/products", h(adm.Products))
				ad.Post("/admin/products", h(adm.CreateProduct))
				ad.Patch("/admin/products/{id}", h(adm.UpdateProduct))
				ad.Get("/admin/audit", h(adm.Audit))
				ad.Get("/admin/exports", h(adm.Exports))
				ad.Post("/admin/exports", h(adm.CreateExport))
				ad.Get("/admin/exports/{id}", h(adm.Export))
				ad.Get("/admin/exports/{id}/download", h(adm.DownloadExport))
			})
		})
	})

	return r
}
