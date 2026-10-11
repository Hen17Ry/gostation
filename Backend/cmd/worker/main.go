// Commande worker : exécute les tâches asynq de GoStation (emails, push et reçus Expo, alertes
// favoris, rappels de stock, vidage des stats, purges) et leur scheduler.
//
//	worker               démarre le worker (configuration lue dans l'environnement)
//	worker healthcheck   interroge /readyz en local ; code de sortie 0 si prêt (healthcheck Docker)
//
// Une seule instance tant que le scheduler n'est pas séparé (ARCHITECTURE §7).
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
	"gostation/backend/internal/http/handler"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/platform/healthprobe"
	"gostation/backend/internal/platform/logging"
	"gostation/backend/internal/platform/postgres"
	"gostation/backend/internal/platform/redis"
	"gostation/backend/internal/platform/storage"
)

// version est injectée au build (-ldflags "-X main.version=…").
var version = "dev"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		addr := os.Getenv("WORKER_HEALTH_ADDR")
		if addr == "" {
			addr = ":8081"
		}
		os.Exit(healthprobe.Run(addr, os.Stderr))
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	err := run(ctx, os.Getenv, os.Stdout)
	stop()
	if err != nil {
		fmt.Fprintln(os.Stderr, "gostation-worker:", err)
		os.Exit(1)
	}
}

// run assemble les dépendances, traite les tâches et s'arrête proprement quand ctx est annulé.
func run(ctx context.Context, getenv func(string) string, stdout io.Writer) error {
	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	log := logging.New(stdout, cfg.Log.Level, cfg.Log.Format, nil).
		With(slog.String("service", "worker"), slog.String("version", version))
	log.InfoContext(ctx, "starting", slog.Any("config", cfg))

	pool, err := postgres.Connect(ctx, postgres.Options{
		URL: cfg.Postgres.URL, MaxConns: min(cfg.Postgres.MaxConns, int32(cfg.Jobs.Concurrency)+4), //nolint:gosec // ≤ 504
		AppName: "gostation-worker",
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
	smtp, err := mail.NewSMTP(mail.SMTPConfig{
		Host: cfg.SMTP.Host, Port: cfg.SMTP.Port, Username: cfg.SMTP.Username, Password: cfg.SMTP.Password,
		From: cfg.SMTP.From, TLSMode: cfg.SMTP.TLSMode,
	})
	if err != nil {
		return err
	}
	docs, err := storage.NewLocal(cfg.Documents.StorageDir)
	if err != nil {
		return err
	}
	infra := app.Infra{Pool: pool, Redis: rdb, Mailer: smtp, Storage: docs}
	svc, err := app.NewServices(cfg, infra, log)
	if err != nil {
		return err
	}
	defer func() { _ = svc.Jobs.Close() }()
	w, err := app.NewWorker(cfg, svc, infra, log, app.WorkerOptions{})
	if err != nil {
		return err
	}

	// Sondes /healthz et /readyz (PostgreSQL et Redis) pour le healthcheck Docker.
	rs := respond.New(log)
	health := handler.NewHealth(rs, log, 2*time.Second, map[string]handler.Check{
		"postgres": svc.Store.Ping,
		"redis":    func(ctx context.Context) error { return rdb.Ping(ctx).Err() },
	})
	mux := http.NewServeMux()
	mux.Handle("GET /healthz", handler.Handle(rs, health.Live))
	mux.Handle("GET /readyz", handler.Handle(rs, health.Ready))
	probe := &http.Server{Addr: cfg.Jobs.HealthAddr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	ln, err := new(net.ListenConfig).Listen(ctx, "tcp", cfg.Jobs.HealthAddr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", cfg.Jobs.HealthAddr, err)
	}
	probeErr := make(chan error, 1)
	go func() { probeErr <- probe.Serve(ln) }()

	if err := w.Start(); err != nil {
		return err
	}
	log.InfoContext(ctx, "processing tasks", slog.Int("concurrency", cfg.Jobs.Concurrency),
		slog.String("health_addr", ln.Addr().String()))

	select {
	case err := <-probeErr:
		w.Shutdown()
		return fmt.Errorf("health server: %w", err)
	case <-ctx.Done():
	}
	log.InfoContext(ctx, "shutting down", slog.String("timeout", cfg.Jobs.ShutdownTimeout.String()))
	health.SetDraining()
	w.Shutdown()
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := probe.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("health server shutdown: %w", err)
	}
	if err := <-probeErr; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("health server: %w", err)
	}
	log.InfoContext(ctx, "stopped")
	return nil
}
