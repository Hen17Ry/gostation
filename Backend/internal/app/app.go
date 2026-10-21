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

	"gostation/backend/internal/analytics"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/auth"
	"gostation/backend/internal/catalog"
	"gostation/backend/internal/config"
	"gostation/backend/internal/document"
	"gostation/backend/internal/export"
	"gostation/backend/internal/favorite"
	"gostation/backend/internal/http/handler"
	"gostation/backend/internal/http/middleware"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/http/router"
	"gostation/backend/internal/jobs"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/notification"
	"gostation/backend/internal/platform/crypto"
	"gostation/backend/internal/platform/errtrack"
	"gostation/backend/internal/platform/osrm"
	"gostation/backend/internal/platform/storage"
	"gostation/backend/internal/privacy"
	"gostation/backend/internal/push"
	"gostation/backend/internal/ratelimit"
	"gostation/backend/internal/reminder"
	"gostation/backend/internal/report"
	"gostation/backend/internal/retention"
	"gostation/backend/internal/search"
	"gostation/backend/internal/searchcache"
	"gostation/backend/internal/searchstats"
	"gostation/backend/internal/station"
	"gostation/backend/internal/store"
	"gostation/backend/internal/worker"
)

// Infra regroupe les clients d'infrastructure, ouverts par l'appelant.
type Infra struct {
	Pool  *pgxpool.Pool
	Redis *goredis.Client
	// Mailer envoie réellement (SMTP) : seul le worker s'en sert. Les services ne font que mettre
	// les emails en file (mail.Queue, tâche email:send) ; l'API peut donc le laisser à nil.
	Mailer  mail.Mailer
	Storage storage.Storage
	// OSRM est une dépendance douce : en panne, la recherche se replie sur le vol d'oiseau.
	OSRM *osrm.Client
	// Pusher remplace celui de la configuration (Expo si EXPO_ACCESS_TOKEN, factice sinon).
	Pusher push.Pusher
	// Errors envoie les erreurs serveur au suivi des plantages (GlitchTip, D90) ; nil ou sans DSN :
	// rien n'est envoyé.
	Errors *errtrack.Tracker
	// Clock remplace l'horloge des rappels, des alertes favoris, des stats admin, des exports et
	// des quotas (tests d'intégration).
	Clock func() time.Time
}

// Services regroupe les services métier.
type Services struct {
	Store    *store.Store
	Auth     *auth.Service
	Station  *station.Service
	Search   *search.Service
	Stats    *searchstats.Flusher
	OSRM     *osrm.Client
	Limiter  *ratelimit.Limiter
	Sessions *auth.SessionStore
	Tokens   *auth.TokenManager
	// Étape 6 : tâches asynq, notifications, rappels, signalements, favoris, purges.
	Jobs          *jobs.Client
	Emails        *mail.Queue
	Pusher        push.Pusher
	Notifications *notification.Service
	Reminders     *reminder.Service
	Reports       *report.Service
	Favorites     *favorite.Service
	Retention     *retention.Purger
	// Étape 7 : tableau de bord et stats, catalogue, exports, lecture du journal d'audit.
	Analytics *analytics.Service
	Catalog   *catalog.Service
	Exports   *export.Service
	Audit     *audit.Reader
	// Étape 10A : droits des personnes (demandes, copie des données, suppression du compte).
	Privacy *privacy.Service
	// Suivi des plantages (Infra.Errors).
	Errors *errtrack.Tracker
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
	linkKey, _ := derive("export-link")
	pseudonymKey, _ := derive("export-pseudonym")
	privacyLinkKey, _ := derive("privacy-export-link")
	privacyCodeKey, _ := derive("privacy-request-code")
	queueKey, _ := derive("email-queue")
	queueSealer, err := crypto.NewSealer(queueKey)
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
	var limiterOpts []ratelimit.Option
	if infra.Clock != nil {
		limiterOpts = append(limiterOpts, ratelimit.WithClock(infra.Clock))
	}
	limiter := ratelimit.New(infra.Redis, limiterOpts...)
	jobsClient := jobs.NewClient(infra.Redis, cfg.Push.ReceiptsDelay)
	emails := mail.NewQueue(jobsClient, queueSealer)
	// La révocation d'une session supprime son appareil push (notifSvc est construit après les
	// sessions : il en a lui-même besoin pour écarter les appareils de sessions expirées).
	var notifSvc *notification.Service
	sessions := auth.NewSessionStore(infra.Redis, auth.WithRevokeHook(func(ctx context.Context, sid string) {
		notifSvc.SessionRevoked(ctx, sid)
	}))
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
		Mailer:     emails,
		Templates:  renderer,
		Documents:  docs,
		Audit:      auditLog,
		TOTPSealer: totpSealer,
		EmailKey:   emailKey,
		Log:        log,
	})
	pusher := infra.Pusher
	if pusher == nil {
		if pusher, err = newPusher(cfg, log); err != nil {
			return nil, err
		}
	}
	notifSvc = notification.NewService(notification.Deps{
		Store: st, Queue: jobsClient, Pusher: pusher, Sessions: sessions, Log: log,
	})
	cache := searchcache.New(infra.Redis)
	stationSvc := station.NewService(station.Config{
		Timezone: cfg.Timezone, MaxCylinders: cfg.Stock.MaxCylinders, MaxLiters: cfg.Stock.MaxLiters,
		StaleAfter: cfg.Stock.StaleAfter, ExpiredAfter: cfg.Stock.ExpiredAfter,
	}, station.Deps{
		Store: st, Documents: docs, Audit: auditLog, Cache: cache,
		Mailer: emails, Templates: renderer, Restock: jobsClient, Decisions: notifSvc, Log: log,
	})
	osrmClient := infra.OSRM
	if osrmClient == nil {
		if osrmClient, err = osrm.New(cfg.OSRM.URL, cfg.OSRM.Timeout); err != nil {
			return nil, err
		}
	}
	privacySvc := privacy.NewService(privacy.Config{
		Timezone: cfg.Timezone, RequestDeadline: cfg.Privacy.RequestDeadline, DueSoon: cfg.Privacy.DueSoon,
		ContactEmail: cfg.Privacy.ContactEmail,
	}, privacy.Deps{
		Store: st, Storage: infra.Storage, Envelope: envelope, Documents: docs, Queue: jobsClient,
		Mailer: emails, Templates: renderer, Sessions: sessions, Passwords: authSvc, Cache: cache, Audit: auditLog,
		Redis: infra.Redis, LinkKey: privacyLinkKey, CodeKey: privacyCodeKey, PseudonymKey: pseudonymKey,
		Log: log, Clock: infra.Clock,
	})
	searchSvc := search.New(search.Config{
		Timezone: cfg.Timezone, CacheTTL: cfg.Search.CacheTTL, MinResults: cfg.Search.MinResults,
		MaxCandidates: cfg.Search.MaxCandidates, StaleAfter: cfg.Stock.StaleAfter, ExpiredAfter: cfg.Stock.ExpiredAfter,
	}, st, infra.Redis, cache, osrmClient, searchstats.NewRecorder(infra.Redis), log)

	return &Services{
		Store: st, Auth: authSvc, Station: stationSvc, Search: searchSvc, OSRM: osrmClient, Errors: infra.Errors,
		Stats: searchstats.NewFlusher(infra.Redis, st, cfg.Timezone, log), Limiter: limiter,
		Sessions: sessions, Tokens: tokens, CSRFKey: csrfKey, EmailKey: emailKey,
		Jobs: jobsClient, Emails: emails, Pusher: pusher, Notifications: notifSvc,
		Reminders: reminder.NewService(reminder.Config{Timezone: cfg.Timezone, Interval: cfg.Reminders.Interval}, reminder.Deps{
			Store: st, Notifier: notifSvc, Schedules: stationSvc, Mailer: emails, Templates: renderer, Log: log, Clock: infra.Clock,
		}),
		Reports: report.NewService(report.Config{Timezone: cfg.Timezone}, report.Deps{
			Store: st, Notifier: notifSvc, Cache: cache, Audit: auditLog, Log: log,
		}),
		Favorites: favorite.NewService(favorite.Config{Timezone: cfg.Timezone}, favorite.Deps{
			Store: st, Notifier: notifSvc, Log: log, Clock: infra.Clock,
		}),
		Retention: retention.New(retention.Config{
			Timezone: cfg.Timezone, Notifications: cfg.Retention.Notifications, BackInStockAlerts: cfg.Retention.BackInStockAlerts,
			DeviceTokens: cfg.Retention.DeviceTokens, InactiveAccounts: cfg.Retention.InactiveAccounts,
			InactivityWarning: cfg.Retention.InactivityWarning, ReportAuthors: cfg.Retention.ReportAuthors,
			Reports: cfg.Retention.Reports, AuditLogs: cfg.Retention.AuditLogs, RejectedDocuments: cfg.Retention.RejectedDocuments,
			DeletedStationDocuments: cfg.Retention.DeletedStationDocuments, StockHistory: cfg.Retention.StockHistory,
			DataRequests: cfg.Retention.DataRequests, AdminAlerts: cfg.Retention.AdminAlerts, ExportRecords: cfg.Retention.ExportRecords,
			LocationRequests: cfg.Retention.LocationRequests,
		}, retention.Deps{
			Store: st, Storage: infra.Storage, Privacy: privacySvc, Mailer: emails, Templates: renderer,
			PseudonymKey: pseudonymKey, Log: log, Clock: infra.Clock,
		}),
		Analytics: analytics.New(analytics.Config{
			Timezone: cfg.Timezone, StaleAfter: cfg.Stock.StaleAfter, ExpiredAfter: cfg.Stock.ExpiredAfter,
		}, st, infra.Clock),
		Catalog: catalog.NewService(st, cache, auditLog, log),
		Exports: export.NewService(export.Config{
			Timezone: cfg.Timezone, StaleAfter: cfg.Stock.StaleAfter, ExpiredAfter: cfg.Stock.ExpiredAfter,
		}, export.Deps{
			Store: st, Storage: infra.Storage, Envelope: envelope, Queue: jobsClient, Audit: auditLog, Log: log,
			LinkKey: linkKey, PseudonymKey: pseudonymKey, Clock: infra.Clock,
		}),
		Audit:   audit.NewReader(st),
		Privacy: privacySvc,
	}, nil
}

// OpenStorage ouvre le stockage des fichiers chiffrés choisi par STORAGE_DRIVER (cmd/api,
// cmd/worker et cmd/e2efixtures partagent ainsi le même choix).
func OpenStorage(ctx context.Context, cfg config.Config) (storage.Storage, error) {
	st := cfg.Documents.Storage
	if st.Driver != "s3" {
		return storage.NewLocal(cfg.Documents.StorageDir)
	}
	return storage.NewS3(ctx, storage.S3Config{
		Endpoint: st.S3Endpoint, Region: st.S3Region, Bucket: st.S3Bucket,
		AccessKey: st.S3AccessKey, SecretKey: st.S3SecretKey,
		TLS: st.S3TLS, PathStyle: st.S3PathStyle, Prefix: st.S3Prefix,
	})
}

// newPusher choisit Expo si EXPO_ACCESS_TOKEN est défini, le Pusher factice sinon (journal du
// seul type de notification, sans donnée personnelle).
func newPusher(cfg config.Config, log *slog.Logger) (push.Pusher, error) {
	if cfg.Push.ExpoAccessToken == "" {
		if cfg.Env == config.EnvProduction {
			log.Warn("EXPO_ACCESS_TOKEN is empty: push notifications are only logged")
		}
		return push.NewFake(log), nil
	}
	return push.NewExpo(cfg.Push.ExpoURL, cfg.Push.ExpoAccessToken, cfg.Push.Timeout)
}

// WorkerOptions ajuste le worker (tests : scheduler coupé, scrutation rapide des files).
type WorkerOptions struct {
	DisableScheduler     bool
	PollInterval         time.Duration
	DelayedCheckInterval time.Duration
}

// NewWorker construit le worker asynq (cmd/worker et tests d'intégration). infra.Mailer est le
// serveur SMTP réel.
func NewWorker(cfg config.Config, svc *Services, infra Infra, log *slog.Logger, opts WorkerOptions) (*worker.Worker, error) {
	if infra.Mailer == nil {
		return nil, fmt.Errorf("app: the worker needs an SMTP mailer")
	}
	return worker.New(worker.Config{
		Concurrency: cfg.Jobs.Concurrency, ShutdownTimeout: cfg.Jobs.ShutdownTimeout,
		RetryBaseDelay: cfg.Jobs.RetryBaseDelay, RetryMaxDelay: cfg.Jobs.RetryMaxDelay,
		Timezone: cfg.Timezone, StatsFlushInterval: cfg.Search.StatsFlushInterval,
		Scheduler: !opts.DisableScheduler, PollInterval: opts.PollInterval, DelayedCheckInterval: opts.DelayedCheckInterval,
	}, infra.Redis, worker.Tasks{
		SMTP: infra.Mailer, Emails: svc.Emails, Stats: svc.Stats, Notifications: svc.Notifications,
		Reminders: svc.Reminders, Favorites: svc.Favorites, Retention: svc.Retention,
		Analytics: svc.Analytics, Exports: svc.Exports, Privacy: svc.Privacy, Errors: svc.Errors,
	}, log)
}

// readinessTimeout borne la vérification de chaque dépendance par /readyz.
const readinessTimeout = 2 * time.Second

// NewHandler construit le handler HTTP et les sondes de santé.
func NewHandler(cfg config.Config, svc *Services, rdb *goredis.Client, log *slog.Logger) (http.Handler, *handler.Health) {
	rs := respond.New(log, respond.WithReporter(svc.Errors))
	health := handler.NewHealth(rs, log, readinessTimeout, map[string]handler.Check{
		"postgres": svc.Store.Ping,
		"redis":    func(ctx context.Context) error { return rdb.Ping(ctx).Err() },
		"osrm":     svc.OSRM.Ping,
	})
	cookies := handler.Cookies{Secure: cfg.Auth.CookieSecure}
	clientKeys := middleware.NewClientKeys(cfg.RateLimit.Key)
	authHandler := handler.NewAuth(rs, svc.Auth, svc.Limiter, clientKeys, cookies, svc.CSRFKey, svc.EmailKey, log)

	h := router.New(router.Config{
		RequestTimeout:     cfg.HTTP.RequestTimeout,
		MaxBodyBytes:       cfg.HTTP.MaxBodyBytes,
		DocumentBodyBytes:  cfg.Documents.MaxBytes + 256<<10, // justificatif + champs du formulaire
		TrustedProxies:     cfg.HTTP.TrustedProxies,
		CORSAllowedOrigins: cfg.HTTP.CORSAllowedOrigins,
		IPRateLimit:        cfg.RateLimit.IPRequests,
		IPRateWindow:       cfg.RateLimit.IPWindow,
		SearchIPLimit:      cfg.Search.RateLimitIP,
		SearchClientLimit:  cfg.Search.RateLimitClient,
	}, router.Deps{
		Log:           log,
		Responder:     rs,
		Health:        health,
		Products:      svc.Store,
		Limiter:       svc.Limiter,
		ClientKeys:    clientKeys,
		Authenticator: middleware.NewAuthenticator(svc.Tokens, svc.Sessions, svc.CSRFKey, cookies.Access(), rs),
		Auth:          authHandler,
		Me:            handler.NewMe(rs, svc.Auth, authHandler, svc.Privacy),
		Stations:      handler.NewStations(rs, svc.Station),
		Search:        handler.NewSearch(rs, svc.Search),
		Notifications: handler.NewNotifications(rs, svc.Notifications),
		Favorites:     handler.NewFavorites(rs, svc.Favorites),
		Reports:       handler.NewReports(rs, svc.Reports),
		Reminders:     handler.NewReminders(rs, svc.Reminders),
		Privacy:       handler.NewPrivacy(rs, svc.Privacy),
		Admin: handler.NewAdmin(rs, handler.AdminDeps{
			Analytics: svc.Analytics, Users: svc.Auth, Catalog: svc.Catalog, Audit: svc.Audit,
			Exports: svc.Exports, Privacy: svc.Privacy, Timezone: cfg.Timezone,
		}),
		EmailVerifier: svc.Auth,
		StationStatus: svc.Station,
	})
	return h, health
}
