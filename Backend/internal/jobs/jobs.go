// Package jobs regroupe ce que l'API et le worker partagent autour d'asynq : types de tâches,
// files, charges utiles, client de mise en file, politique de retry et journal slog.
//
// Les paquets métier ne dépendent pas d'asynq : ils déclarent de petites interfaces
// (EnqueueEmail, EnqueuePush…) que *Client implémente. Les handlers des tâches sont assemblés
// dans internal/worker.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	goredis "github.com/redis/go-redis/v9"
)

// Files, par priorité décroissante (poids du worker : 6, 3, 1).
const (
	QueueCritical = "critical" // push
	QueueDefault  = "default"  // emails, alertes favoris
	QueueLow      = "low"      // tâches périodiques, reçus Expo
)

// Queues renvoie les poids des files pour asynq.Config.
func Queues() map[string]int {
	return map[string]int{QueueCritical: 6, QueueDefault: 3, QueueLow: 1}
}

// Types de tâches (identifiants stables : ils vivent dans Redis entre deux déploiements).
const (
	TypeEmailSend      = "email:send"
	TypePushSend       = "push:send"
	TypePushReceipts   = "push:receipts"
	TypeBackInStock    = "favorites:back_in_stock"
	TypeReleaseAlerts  = "favorites:release"
	TypeRemindersScan  = "reminders:scan"
	TypeStatsFlush     = "stats:flush"
	TypeRetentionPurge = "retention:purge"
)

// EmailPayload porte un email chiffré (adresse et codes à usage unique ne sont jamais en clair
// dans Redis, y compris dans les tâches archivées après échec).
type EmailPayload struct {
	Sealed []byte `json:"s"`
}

// PushPayload liste les notifications dont il faut envoyer les push.
type PushPayload struct {
	NotificationIDs []uuid.UUID `json:"n"`
}

// TicketRef relie un ticket Expo à l'appareil visé. TokenHash (SHA-256 hexadécimal du token)
// évite de supprimer un appareil réenregistré avec un nouveau token entre-temps.
type TicketRef struct {
	ID        string    `json:"i"`
	DeviceID  uuid.UUID `json:"d"`
	TokenHash string    `json:"h"`
}

// ReceiptsPayload liste les tickets dont il faut lire les reçus.
type ReceiptsPayload struct {
	Tickets []TicketRef `json:"t"`
}

// BackInStockPayload signale des produits repassés de 0 à plus de 0 dans une station.
type BackInStockPayload struct {
	StationID  uuid.UUID `json:"s"`
	ProductIDs []int16   `json:"p"`
}

// Client met des tâches en file. Il partage le pool de connexions Redis de l'application.
type Client struct {
	c             *asynq.Client
	receiptsDelay time.Duration
}

// NewClient construit le client ; receiptsDelay est le délai de lecture des reçus Expo.
func NewClient(rdb goredis.UniversalClient, receiptsDelay time.Duration) *Client {
	return &Client{c: asynq.NewClientFromRedisClient(rdb), receiptsDelay: receiptsDelay}
}

// Close libère le client (le pool Redis partagé reste ouvert).
func (c *Client) Close() error { return c.c.Close() }

func (c *Client) enqueue(ctx context.Context, typ string, payload any, opts ...asynq.Option) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("jobs: encode %s: %w", typ, err)
	}
	if _, err := c.c.EnqueueContext(ctx, asynq.NewTask(typ, raw), opts...); err != nil {
		return fmt.Errorf("jobs: enqueue %s: %w", typ, err)
	}
	return nil
}

// EnqueueEmail met en file un email chiffré (mail.Queue).
func (c *Client) EnqueueEmail(ctx context.Context, sealed []byte) error {
	return c.enqueue(ctx, TypeEmailSend, EmailPayload{Sealed: sealed},
		asynq.Queue(QueueDefault), asynq.MaxRetry(10), asynq.Timeout(45*time.Second))
}

// EnqueuePush met en file l'envoi des push de notifications déjà enregistrées.
func (c *Client) EnqueuePush(ctx context.Context, ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	return c.enqueue(ctx, TypePushSend, PushPayload{NotificationIDs: ids},
		asynq.Queue(QueueCritical), asynq.MaxRetry(5), asynq.Timeout(2*time.Minute))
}

// EnqueueReceipts programme la lecture des reçus Expo après le délai configuré (15 min).
func (c *Client) EnqueueReceipts(ctx context.Context, tickets []TicketRef) error {
	if len(tickets) == 0 {
		return nil
	}
	return c.enqueue(ctx, TypePushReceipts, ReceiptsPayload{Tickets: tickets},
		asynq.Queue(QueueLow), asynq.ProcessIn(c.receiptsDelay), asynq.MaxRetry(5), asynq.Timeout(2*time.Minute))
}

// EnqueueBackInStock met en file les alertes « de retour en stock » d'une station.
func (c *Client) EnqueueBackInStock(ctx context.Context, stationID uuid.UUID, productIDs []int16) error {
	if len(productIDs) == 0 {
		return nil
	}
	return c.enqueue(ctx, TypeBackInStock, BackInStockPayload{StationID: stationID, ProductIDs: productIDs},
		asynq.Queue(QueueDefault), asynq.MaxRetry(5), asynq.Timeout(2*time.Minute))
}

// Decode lit la charge utile d'une tâche ; une charge illisible ne sera jamais traitée : elle
// est abandonnée sans retry.
func Decode[T any](t *asynq.Task) (T, error) {
	var v T
	if err := json.Unmarshal(t.Payload(), &v); err != nil {
		return v, fmt.Errorf("jobs: decode %s: %w: %w", t.Type(), err, asynq.SkipRetry)
	}
	return v, nil
}

// SkipRetry marque une erreur définitive (la tâche part aux archives sans nouvel essai).
func SkipRetry(err error) error { return errors.Join(err, asynq.SkipRetry) }

// RetryDelay renvoie un backoff exponentiel : base × 2^n, plafonné à maxDelay, avec ± 25 %
// d'aléa pour étaler les reprises après une panne (n = nombre d'essais déjà faits).
func RetryDelay(base, maxDelay time.Duration) asynq.RetryDelayFunc {
	return func(n int, _ error, _ *asynq.Task) time.Duration {
		d := base
		for i := 0; i < n && d < maxDelay; i++ {
			d *= 2
		}
		d = min(d, maxDelay)
		jitter := time.Duration(rand.Int64N(int64(d)/2+1)) - d/4 //nolint:gosec // aléa non cryptographique
		return d + jitter
	}
}

// Logger adapte slog à l'interface de journal d'asynq.
type Logger struct{ log *slog.Logger }

// NewLogger construit l'adaptateur.
func NewLogger(log *slog.Logger) Logger {
	return Logger{log: log.With(slog.String("component", "asynq"))}
}

func (l Logger) emit(level slog.Level, args []any) {
	l.log.Log(context.Background(), level, fmt.Sprint(args...))
}

// Debug journalise au niveau debug.
func (l Logger) Debug(args ...any) { l.emit(slog.LevelDebug, args) }

// Info journalise au niveau info.
func (l Logger) Info(args ...any) { l.emit(slog.LevelInfo, args) }

// Warn journalise au niveau warn.
func (l Logger) Warn(args ...any) { l.emit(slog.LevelWarn, args) }

// Error journalise au niveau error.
func (l Logger) Error(args ...any) { l.emit(slog.LevelError, args) }

// Fatal journalise au niveau error ; asynq ne l'appelle que sur une erreur de démarrage, que
// Server.Start renvoie aussi : on laisse l'appelant décider de l'arrêt.
func (l Logger) Fatal(args ...any) { l.emit(slog.LevelError, args) }
