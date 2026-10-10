// Package router assemble le routeur chi : middlewares globaux, sondes de santé et API /api/v1.
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
	RequestTimeout     time.Duration
	MaxBodyBytes       int64
	TrustedProxies     []netip.Prefix
	CORSAllowedOrigins []string
	IPRateLimit        int
	IPRateWindow       time.Duration
}

// Deps regroupe les dépendances injectées.
type Deps struct {
	Log       *slog.Logger
	Responder *respond.Responder
	Health    *handler.Health
	Products  handler.ProductLister
	Limiter   middleware.Limiter
}

// New construit le handler HTTP de l'API.
func New(cfg Config, d Deps) http.Handler {
	rs := d.Responder
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
			AllowedOrigins:   cfg.CORSAllowedOrigins,
			AllowedMethods:   []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions},
			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", middleware.HeaderRequestID},
			ExposedHeaders:   []string{middleware.HeaderRequestID, "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"},
			AllowCredentials: true,
			MaxAge:           300,
		}))
	}

	// À déclarer avant les sous-routeurs, qui en héritent.
	r.NotFound(handler.Handle(rs, func(_ http.ResponseWriter, req *http.Request) error {
		return apperr.New(http.StatusNotFound, apperr.CodeRouteNotFound, "No route matches "+req.Method+" "+req.URL.Path+".")
	}))
	r.MethodNotAllowed(handler.Handle(rs, func(_ http.ResponseWriter, req *http.Request) error {
		return apperr.New(http.StatusMethodNotAllowed, apperr.CodeMethodNotAllowed, "Method "+req.Method+" is not allowed on "+req.URL.Path+".")
	}))

	r.Get("/healthz", handler.Handle(rs, d.Health.Live))
	r.Get("/readyz", handler.Handle(rs, d.Health.Ready))

	products := handler.NewProducts(rs, d.Products)

	r.Route("/api/v1", func(api chi.Router) {
		api.Use(
			middleware.Timeout(cfg.RequestTimeout),
			middleware.MaxBodyBytes(cfg.MaxBodyBytes, rs),
			chimw.Compress(5, "application/json", respond.ContentTypeProblem),
			middleware.RateLimit(d.Limiter, middleware.RateLimitPolicy{
				Name:   "ip",
				Limit:  cfg.IPRateLimit,
				Window: cfg.IPRateWindow,
				Key:    middleware.ByClientIP,
			}, d.Log, rs),
		)
		api.Get("/products", handler.Handle(rs, products.List))
	})

	return r
}
