// Commande api : serveur HTTP de GoStation.
//
//	api               démarre le serveur (configuration lue dans l'environnement)
//	api healthcheck   interroge /readyz en local ; code de sortie 0 si prêt (healthcheck Docker,
//	                  l'image distroless n'ayant ni shell ni curl)
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata"

	"gostation/backend/internal/app"
	"gostation/backend/internal/config"
	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/platform/logging"
	"gostation/backend/internal/platform/osrm"
	"gostation/backend/internal/platform/postgres"
	"gostation/backend/internal/platform/redis"
	"gostation/backend/internal/platform/storage"
)

// version est injectée au build (-ldflags "-X main.version=…"). Seule variable de paquet,
// imposée par le linker, jamais modifiée à l'exécution.
var version = "dev"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck(os.Getenv))
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	err := run(ctx, os.Getenv, os.Stdout)
	stop()
	if err != nil {
		fmt.Fprintln(os.Stderr, "gostation-api:", err)
		os.Exit(1)
	}
}

// run assemble les dépendances, sert les requêtes et s'arrête proprement quand ctx est annulé.
func run(ctx context.Context, getenv func(string) string, stdout io.Writer) error {
	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	log := logging.New(stdout, cfg.Log.Level, cfg.Log.Format, httpctx.LogAttrs).
		With(slog.String("service", "api"), slog.String("version", version))
	log.InfoContext(ctx, "starting", slog.Any("config", cfg))

	pool, err := postgres.Connect(ctx, postgres.Options{
		URL: cfg.Postgres.URL, MaxConns: cfg.Postgres.MaxConns, AppName: "gostation-api",
	})
	if err != nil {
		return err
	}
	defer pool.Close()

	rdb, err := redis.Connect(ctx, cfg.Redis.URL)
	if err != nil {
		return err
	}
	defer func() { _ = rdb.Close() }()

	// OSRM est une dépendance « douce » : son absence dégrade la recherche (classement à vol
	// d'oiseau) sans empêcher le démarrage ; /readyz la signale.
	osrmClient, err := osrm.New(cfg.OSRM.URL, cfg.OSRM.Timeout)
	if err != nil {
		return err
	}
	smtp, err := mail.NewSMTP(mail.SMTPConfig{
		Host: cfg.SMTP.Host, Port: cfg.SMTP.Port, Username: cfg.SMTP.Username, Password: cfg.SMTP.Password,
		From: cfg.SMTP.From, TLSMode: cfg.SMTP.TLSMode,
	})
	if err != nil {
		return err
	}
	mailer := mail.NewAsync(smtp, log, 2, 256)
	docs, err := storage.NewLocal(cfg.Documents.StorageDir)
	if err != nil {
		return err
	}

	svc, err := app.NewServices(cfg, app.Infra{Pool: pool, Redis: rdb, Mailer: mailer, Storage: docs, OSRM: osrmClient}, log)
	if err != nil {
		return err
	}
	handler, health := app.NewHandler(cfg, svc, rdb, log)

	// Vidage périodique des compteurs anonymes de recherche (D23) ; dernier vidage à l'arrêt.
	statsCtx, stopStats := context.WithCancel(context.WithoutCancel(ctx))
	statsDone := make(chan struct{})
	go func() { defer close(statsDone); svc.Stats.Run(statsCtx, cfg.Search.StatsFlushInterval) }()
	defer func() { stopStats(); <-statsDone }()

	srv := &http.Server{
		Addr:              cfg.HTTP.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       cfg.HTTP.ReadTimeout,
		WriteTimeout:      cfg.HTTP.WriteTimeout,
		IdleTimeout:       cfg.HTTP.IdleTimeout,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}

	ln, err := new(net.ListenConfig).Listen(ctx, "tcp", cfg.HTTP.Addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", cfg.HTTP.Addr, err)
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(ln) }()
	log.InfoContext(ctx, "listening", slog.String("addr", ln.Addr().String()))

	select {
	case err := <-serveErr:
		return fmt.Errorf("http server: %w", err)
	case <-ctx.Done():
	}

	// Arrêt propre : /readyz passe en 503, les requêtes en cours se terminent dans le délai imparti.
	log.InfoContext(ctx, "shutting down", slog.String("timeout", cfg.HTTP.ShutdownTimeout.String()))
	health.SetDraining()
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cfg.HTTP.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("http server: %w", err)
	}
	if err := mailer.Close(shutdownCtx); err != nil {
		log.WarnContext(ctx, "emails still queued at shutdown", slog.Any("err", err))
	}
	log.InfoContext(ctx, "stopped")
	return nil
}

// healthcheck interroge /readyz sur le port local de HTTP_ADDR.
func healthcheck(getenv func(string) string) int {
	addr := getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck: invalid HTTP_ADDR:", err)
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:"+port+"/readyz", nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		return 1
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		return 1
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthcheck: /readyz returned", resp.StatusCode)
		return 1
	}
	return 0
}
