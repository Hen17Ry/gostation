// Commande worker : exécute les tâches asynq de GoStation (emails, push et reçus Expo, alertes
// favoris, rappels de stock, vidage des stats, purges) et leur scheduler.
//
//	worker               démarre le worker (configuration lue dans l'environnement)
//	worker healthcheck   interroge /readyz en local ; code de sortie 0 si prêt (healthcheck Docker)
//	worker purge-dry-run affiche, règle par règle, ce que les purges traiteraient maintenant, sans
//	                     rien modifier (make purge-dry-run)
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
	"gostation/backend/internal/platform/errtrack"
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
	var err error
	if len(os.Args) > 1 && os.Args[1] == "purge-dry-run" {
		err = purgeDryRun(ctx, os.Getenv, os.Stdout)
	} else {
		err = run(ctx, os.Getenv, os.Stdout)
	}
	stop()
	if err != nil {
		fmt.Fprintln(os.Stderr, "gostation-worker:", err)
		os.Exit(1)
	}
}

// connect charge la configuration et assemble l'infrastructure et les services ; closeAll les libère.
func connect(ctx context.Context, getenv func(string) string, stdout io.Writer) (
	cfg config.Config, log *slog.Logger, infra app.Infra, svc *app.Services, closeAll func(), err error,
) {
	closeAll = func() {}
	if cfg, err = config.Load(getenv); err != nil {
		return
	}
	log = logging.New(stdout, cfg.Log.Level, cfg.Log.Format, nil).
		With(slog.String("service", "worker"), slog.String("version", version))
	log.InfoContext(ctx, "starting", slog.Any("config", cfg))

	pool, err := postgres.Connect(ctx, postgres.Options{
		URL: cfg.Postgres.URL, MaxConns: min(cfg.Postgres.MaxConns, int32(cfg.Jobs.Concurrency)+4), //nolint:gosec // ≤ 504
		AppName: "gostation-worker",
	})
	if err != nil {
		return
	}
	closers := []func(){pool.Close}
	closeAll = func() {
		for i := len(closers) - 1; i >= 0; i-- {
			closers[i]()
		}
	}
	rdb, err := redis.Connect(ctx, cfg.Redis.URL)
	if err != nil {
		return
	}
	closers = append(closers, func() { _ = rdb.Close() })
	smtp, err := mail.NewSMTP(mail.SMTPConfig{
		Host: cfg.SMTP.Host, Port: cfg.SMTP.Port, Username: cfg.SMTP.Username, Password: cfg.SMTP.Password,
		From: cfg.SMTP.From, TLSMode: cfg.SMTP.TLSMode,
	})
	if err != nil {
		return
	}
	docs, err := storage.NewLocal(cfg.Documents.StorageDir)
	if err != nil {
		return
	}
	errs, err := errtrack.New(errtrack.Config{
		DSN: cfg.ErrorTracking.DSN, Environment: cfg.ErrorTracking.Environment, Release: version, Service: "worker",
	})
	if err != nil {
		return
	}
	closers = append(closers, func() { errs.Flush(2 * time.Second) })
	infra = app.Infra{Pool: pool, Redis: rdb, Mailer: smtp, Storage: docs, Errors: errs}
	if svc, err = app.NewServices(cfg, infra, log); err != nil {
		return
	}
	closers = append(closers, func() { _ = svc.Jobs.Close() })
	return cfg, log, infra, svc, closeAll, nil
}

// purgeDryRun affiche, pour chaque règle de conservation, le nombre de lignes qu'elle traiterait
// maintenant. Rien n'est modifié : seules les requêtes Count des règles sont exécutées.
func purgeDryRun(ctx context.Context, getenv func(string) string, stdout io.Writer) error {
	_, _, _, svc, closeAll, err := connect(ctx, getenv, io.Discard)
	defer closeAll()
	if err != nil {
		return err
	}
	sims, err := svc.Retention.DryRun(ctx)
	if err != nil {
		return err
	}
	fmt.Fprintln(stdout, "Simulation des purges (aucune modification) :")
	var total int64
	for _, sim := range sims {
		fmt.Fprintf(stdout, "  %-28s %8d\n", sim.Rule, sim.Count)
		total += sim.Count
	}
	fmt.Fprintf(stdout, "  %-28s %8d\n", "total", total)
	return nil
}

// run assemble les dépendances, traite les tâches et s'arrête proprement quand ctx est annulé.
func run(ctx context.Context, getenv func(string) string, stdout io.Writer) error {
	cfg, log, infra, svc, closeAll, err := connect(ctx, getenv, stdout)
	defer closeAll()
	if err != nil {
		return err
	}
	w, err := app.NewWorker(cfg, svc, infra, log, app.WorkerOptions{})
	if err != nil {
		return err
	}

	// Sondes /healthz et /readyz (PostgreSQL et Redis) pour le healthcheck Docker.
	rs := respond.New(log)
	health := handler.NewHealth(rs, log, 2*time.Second, map[string]handler.Check{
		"postgres": svc.Store.Ping,
		"redis":    func(ctx context.Context) error { return infra.Redis.Ping(ctx).Err() },
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
