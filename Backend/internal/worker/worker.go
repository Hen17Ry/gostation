// Package worker exécute les tâches asynq de GoStation (cmd/worker) : envoi des emails et des
// push, lecture des reçus Expo, alertes « de retour en stock », rappels de stock, vidage des stats
// de recherche et purges de conservation.
//
// Le scheduler (tâches périodiques) tourne dans le même processus : il ne doit y avoir qu'une
// seule instance du worker tant qu'il n'est pas séparé (ARCHITECTURE §7). Les tâches périodiques
// portent une clé d'unicité, ce qui limite les doublons si deux instances tournaient quand même.
package worker

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/textproto"
	"time"

	"github.com/hibiken/asynq"
	goredis "github.com/redis/go-redis/v9"

	"gostation/backend/internal/favorite"
	"gostation/backend/internal/jobs"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/notification"
	"gostation/backend/internal/reminder"
	"gostation/backend/internal/retention"
	"gostation/backend/internal/searchstats"
)

// Config regroupe les réglages du worker.
type Config struct {
	Concurrency        int
	ShutdownTimeout    time.Duration
	RetryBaseDelay     time.Duration
	RetryMaxDelay      time.Duration
	Timezone           *time.Location
	StatsFlushInterval time.Duration
	// Scheduler démarre les tâches périodiques (désactivé dans les tests, qui les appellent
	// directement).
	Scheduler bool
	// Intervalles de scrutation des files (défauts asynq : 1 s et 5 s), réduits dans les tests.
	PollInterval         time.Duration
	DelayedCheckInterval time.Duration
}

// Tasks regroupe les services qui exécutent les tâches.
type Tasks struct {
	SMTP          mail.Mailer // envoi réel (le Mailer de l'API ne fait que mettre en file)
	Emails        *mail.Queue
	Stats         *searchstats.Flusher
	Notifications *notification.Service
	Reminders     *reminder.Service
	Favorites     *favorite.Service
	Retention     *retention.Purger
}

// Worker est le serveur asynq et son scheduler.
type Worker struct {
	srv   *asynq.Server
	sched *asynq.Scheduler
	mux   *asynq.ServeMux
	t     Tasks
	log   *slog.Logger
}

// New construit le worker (sans le démarrer).
func New(cfg Config, rdb goredis.UniversalClient, t Tasks, log *slog.Logger) (*Worker, error) {
	log = log.With(slog.String("component", "worker"))
	w := &Worker{t: t, log: log, mux: asynq.NewServeMux()}
	w.srv = asynq.NewServerFromRedisClient(rdb, asynq.Config{
		Concurrency:              cfg.Concurrency,
		Queues:                   jobs.Queues(),
		RetryDelayFunc:           jobs.RetryDelay(cfg.RetryBaseDelay, cfg.RetryMaxDelay),
		ShutdownTimeout:          cfg.ShutdownTimeout,
		TaskCheckInterval:        cfg.PollInterval,
		DelayedTaskCheckInterval: cfg.DelayedCheckInterval,
		Logger:                   jobs.NewLogger(log),
		LogLevel:                 asynq.WarnLevel,
		ErrorHandler: asynq.ErrorHandlerFunc(func(ctx context.Context, task *asynq.Task, err error) {
			retried, _ := asynq.GetRetryCount(ctx)
			maxRetry, _ := asynq.GetMaxRetry(ctx)
			log.WarnContext(ctx, "task failed", slog.String("task", task.Type()),
				slog.Int("retried", retried), slog.Int("max_retry", maxRetry), slog.Any("err", err))
		}),
	})
	w.routes()
	if cfg.Scheduler {
		w.sched = asynq.NewSchedulerFromRedisClient(rdb, &asynq.SchedulerOpts{
			Location: cfg.Timezone, Logger: jobs.NewLogger(log), LogLevel: asynq.WarnLevel,
			PostEnqueueFunc: func(_ *asynq.TaskInfo, err error) {
				if err != nil && !errors.Is(err, asynq.ErrDuplicateTask) {
					log.Error("scheduler: enqueue failed", slog.Any("err", err))
				}
			},
		})
		if err := w.schedule(cfg); err != nil {
			return nil, err
		}
	}
	return w, nil
}

// Mux expose le routage des tâches (tests).
func (w *Worker) Mux() *asynq.ServeMux { return w.mux }

func (w *Worker) routes() {
	w.mux.HandleFunc(jobs.TypeEmailSend, w.sendEmail)
	w.mux.HandleFunc(jobs.TypePushSend, w.sendPush)
	w.mux.HandleFunc(jobs.TypePushReceipts, w.checkReceipts)
	w.mux.HandleFunc(jobs.TypeBackInStock, w.backInStock)
	w.mux.HandleFunc(jobs.TypeReleaseAlerts, func(ctx context.Context, _ *asynq.Task) error {
		_, err := w.t.Favorites.ReleasePending(ctx)
		return err
	})
	w.mux.HandleFunc(jobs.TypeRemindersScan, func(ctx context.Context, _ *asynq.Task) error {
		_, err := w.t.Reminders.Scan(ctx)
		return err
	})
	w.mux.HandleFunc(jobs.TypeStatsFlush, func(ctx context.Context, _ *asynq.Task) error {
		_, err := w.t.Stats.Flush(ctx)
		return err
	})
	w.mux.HandleFunc(jobs.TypeRetentionPurge, func(ctx context.Context, _ *asynq.Task) error {
		return w.t.Retention.Run(ctx)
	})
}

// schedule enregistre les tâches périodiques (heure locale : Africa/Porto-Novo).
func (w *Worker) schedule(cfg Config) error {
	entries := []struct {
		spec string
		typ  string
		opts []asynq.Option
	}{
		{"*/15 * * * *", jobs.TypeRemindersScan, []asynq.Option{asynq.Unique(14 * time.Minute), asynq.MaxRetry(1), asynq.Timeout(5 * time.Minute)}},
		{"*/15 * * * *", jobs.TypeReleaseAlerts, []asynq.Option{asynq.Unique(14 * time.Minute), asynq.MaxRetry(1), asynq.Timeout(5 * time.Minute)}},
		{"@every " + cfg.StatsFlushInterval.String(), jobs.TypeStatsFlush, []asynq.Option{asynq.Unique(cfg.StatsFlushInterval), asynq.MaxRetry(3), asynq.Timeout(time.Minute)}},
		{"0 3 * * *", jobs.TypeRetentionPurge, []asynq.Option{asynq.Unique(23 * time.Hour), asynq.MaxRetry(3), asynq.Timeout(30 * time.Minute)}},
	}
	for _, e := range entries {
		opts := append([]asynq.Option{asynq.Queue(jobs.QueueLow)}, e.opts...)
		if _, err := w.sched.Register(e.spec, asynq.NewTask(e.typ, nil), opts...); err != nil {
			return fmt.Errorf("worker: schedule %s: %w", e.typ, err)
		}
	}
	return nil
}

// Start démarre le serveur et le scheduler (non bloquant).
func (w *Worker) Start() error {
	if err := w.srv.Start(w.mux); err != nil {
		return fmt.Errorf("worker: start server: %w", err)
	}
	if w.sched != nil {
		if err := w.sched.Start(); err != nil {
			w.srv.Shutdown()
			return fmt.Errorf("worker: start scheduler: %w", err)
		}
	}
	return nil
}

// Shutdown arrête le scheduler puis le serveur, qui termine les tâches en cours dans la limite
// de ShutdownTimeout (les tâches interrompues sont reprises au redémarrage).
func (w *Worker) Shutdown() {
	if w.sched != nil {
		w.sched.Shutdown()
	}
	w.srv.Shutdown()
}

// ── Handlers ────────────────────────────────────────────────────────────────

// sendEmail déchiffre puis envoie l'email. Une réponse d'erreur SMTP est réduite à son code : le
// texte du serveur peut citer l'adresse du destinataire, qui ne doit finir ni dans les journaux ni dans
// Redis (dernier message d'erreur des tâches).
func (w *Worker) sendEmail(ctx context.Context, t *asynq.Task) error {
	p, err := jobs.Decode[jobs.EmailPayload](t)
	if err != nil {
		return err
	}
	m, err := w.t.Emails.Decode(p.Sealed)
	if err != nil {
		return jobs.SkipRetry(err)
	}
	if err := w.t.SMTP.Send(ctx, m); err != nil {
		var smtpErr *textproto.Error
		if errors.As(err, &smtpErr) {
			return fmt.Errorf("mail: SMTP reply %d", smtpErr.Code)
		}
		return err // connexion, TLS, authentification : aucune donnée du message
	}
	w.log.DebugContext(ctx, "email sent", slog.String("subject", m.Subject))
	return nil
}

func (w *Worker) sendPush(ctx context.Context, t *asynq.Task) error {
	p, err := jobs.Decode[jobs.PushPayload](t)
	if err != nil {
		return err
	}
	return w.t.Notifications.Deliver(ctx, p.NotificationIDs)
}

func (w *Worker) checkReceipts(ctx context.Context, t *asynq.Task) error {
	p, err := jobs.Decode[jobs.ReceiptsPayload](t)
	if err != nil {
		return err
	}
	return w.t.Notifications.CheckReceipts(ctx, p.Tickets)
}

func (w *Worker) backInStock(ctx context.Context, t *asynq.Task) error {
	p, err := jobs.Decode[jobs.BackInStockPayload](t)
	if err != nil {
		return err
	}
	return w.t.Favorites.BackInStock(ctx, p.StationID, p.ProductIDs)
}
