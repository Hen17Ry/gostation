// Package app assemble l'application à partir de la configuration et des clients
// d'infrastructure : services métier (NewServices), puis handler HTTP (NewHandler).
// cmd/api, cmd/admin et les tests d'intégration partagent ainsi exactement le même câblage.
package app

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"log/slog"
	"net/http"
	"runtime"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"gostation/backend/internal/audit"
	"gostation/backend/internal/auth"
	"gostation/backend/internal/config"
	"gostation/backend/internal/document"
	"gostation/backend/internal/http/handler"
	"gostation/backend/internal/http/middleware"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/http/router"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/platform/crypto"
	"gostation/backend/internal/platform/osrm"
	"gostation/backend/internal/platform/storage"
	"gostation/backend/internal/ratelimit"
	"gostation/backend/internal/searchcache"
	"gostation/backend/internal/station"
	"gostation/backend/internal/store"
)

// Infra regroupe les clients d'infrastructure, ouverts par l'appelant.
type Infra struct {
	Pool    *pgxpool.Pool
	Redis   *goredis.Client
	Mailer  mail.Mailer
	Storage storage.Storage
}

// Services regroupe les services métier.
type Services struct {
	Store    *store.Store
	Auth     *auth.Service
	Station  *station.Service
	Limiter  *ratelimit.Limiter
	Sessions *auth.SessionStore
	Tokens   *auth.TokenManager
	// Clés dérivées d'APP_SECRET (une par usage).
	CSRFKey  []byte
	EmailKey []byte
}

// NewServices construit les services métier.
func NewServices(cfg config.Config, infra Infra, log *slog.Logger) (*Services, error) {
	derive := func(info string) ([]byte, error) { return crypto.DeriveKey(cfg.Auth.AppSecret, info) }
	otpKey, err := derive("otp-hmac")
	if err != nil {
		return nil, err
	}
	csrfKey, _ := derive("csrf")
	emailKey, _ := derive("email-fingerprint")
	totpKey, _ := derive("totp-encryption")
	totpSealer, err := crypto.NewSealer(totpKey)
	if err != nil {
		return nil, err
	}
	envelope, err := crypto.NewEnvelope(cfg.Documents.EncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("documents encryption key: %w", err)
	}
	renderer, err := mail.NewRenderer(cfg.Timezone)
	if err != nil {
		return nil, err
	}

	keys := make([]auth.SigningKey, len(cfg.Auth.SigningKeys))
	for i, k := range cfg.Auth.SigningKeys {
		keys[i] = auth.SigningKey{ID: k.ID, Private: ed25519.NewKeyFromSeed(k.Seed)}
	}
	tokens := auth.NewTokenManager(keys, cfg.Auth.Issuer, cfg.Auth.Audience, cfg.Auth.AccessTTL)

	st := store.New(infra.Pool)
	limiter := ratelimit.New(infra.Redis)
	sessions := auth.NewSessionStore(infra.Redis)
	auditLog := audit.New(st, log)
	docs := document.NewService(infra.Storage, envelope, cfg.Documents.MaxBytes)

	authSvc := auth.NewService(auth.Config{
		PrivacyPolicyVersion: cfg.Auth.PrivacyPolicyVersion,
		RefreshTTL:           cfg.Auth.RefreshTTL,
		AdminRefreshTTL:      cfg.Auth.AdminRefreshTTL,
	}, auth.Deps{
		Store:      st,
		Sessions:   sessions,
		OTPs:       auth.NewOTPStore(infra.Redis, otpKey, limiter),
		MFA:        auth.NewMFAStore(infra.Redis),
		Tokens:     tokens,
		Hasher:     auth.NewPasswordHasher(max(2, runtime.NumCPU())),
		Policy:     auth.NewPasswordPolicy(),
		Mailer:     infra.Mailer,
		Templates:  renderer,
		Documents:  docs,
		Audit:      auditLog,
		TOTPSealer: totpSealer,
		EmailKey:   emailKey,
		Log:        log,
	})
	stationSvc := station.NewService(station.Config{
		Timezone: cfg.Timezone, MaxCylinders: cfg.Stock.MaxCylinders, MaxLiters: cfg.Stock.MaxLiters,
		StaleAfter: cfg.Stock.StaleAfter, ExpiredAfter: cfg.Stock.ExpiredAfter,
	}, station.Deps{
		Store: st, Documents: docs, Audit: auditLog, Cache: searchcache.New(infra.Redis),
		Mailer: infra.Mailer, Templates: renderer, Log: log,
	})
	return &Services{
		Store: st, Auth: authSvc, Station: stationSvc, Limiter: limiter,
		Sessions: sessions, Tokens: tokens, CSRFKey: csrfKey, EmailKey: emailKey,
	}, nil
}

// readinessTimeout borne la vérification de chaque dépendance par /readyz.
const readinessTimeout = 2 * time.Second

// NewHandler construit le handler HTTP et les sondes de santé.
func NewHandler(cfg config.Config, svc *Services, rdb *goredis.Client, osrmClient *osrm.Client, log *slog.Logger) (http.Handler, *handler.Health) {
	rs := respond.New(log)
	health := handler.NewHealth(rs, log, readinessTimeout, map[string]handler.Check{
		"postgres": svc.Store.Ping,
		"redis":    func(ctx context.Context) error { return rdb.Ping(ctx).Err() },
		"osrm":     osrmClient.Ping,
	})
	cookies := handler.Cookies{Secure: cfg.Auth.CookieSecure}
	authHandler := handler.NewAuth(rs, svc.Auth, svc.Limiter, cookies, svc.CSRFKey, svc.EmailKey, log)

	h := router.New(router.Config{
		RequestTimeout:     cfg.HTTP.RequestTimeout,
		MaxBodyBytes:       cfg.HTTP.MaxBodyBytes,
		DocumentBodyBytes:  cfg.Documents.MaxBytes + 256<<10, // justificatif + champs du formulaire
		TrustedProxies:     cfg.HTTP.TrustedProxies,
		CORSAllowedOrigins: cfg.HTTP.CORSAllowedOrigins,
		IPRateLimit:        cfg.RateLimit.IPRequests,
		IPRateWindow:       cfg.RateLimit.IPWindow,
	}, router.Deps{
		Log:           log,
		Responder:     rs,
		Health:        health,
		Products:      svc.Store,
		Limiter:       svc.Limiter,
		Authenticator: middleware.NewAuthenticator(svc.Tokens, svc.Sessions, svc.CSRFKey, cookies.Access(), rs),
		Auth:          authHandler,
		Me:            handler.NewMe(rs, svc.Auth, authHandler),
		Stations:      handler.NewStations(rs, svc.Station),
		EmailVerifier: svc.Auth,
		StationStatus: svc.Station,
	})
	return h, health
}
