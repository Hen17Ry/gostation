// Package reminder envoie les rappels de mise à jour des stocks aux gérants (tâche périodique
// reminders:scan, toutes les 15 min) et gère leur mise en sourdine.
//
// Une station reçoit un rappel si elle est ouverte maintenant, si sa dernière mise à jour ou
// confirmation date de plus de 4 h (et son dernier rappel aussi), si elle n'a pas déjà reçu 4
// rappels aujourd'hui et si le gérant ne l'a pas mise en sourdine. Après 3 rappels ignorés de
// suite, l'échéance du suivant déclenche l'escalade au lieu d'un 4e rappel : arrêt pour la
// journée (celle du dernier rappel), email au gérant, alerte admin « gérant inactif ». Une mise
// à jour ou une confirmation remet le compteur d'ignorés à zéro (station.stockActivity).
package reminder

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"gostation/backend/internal/mail"
	"gostation/backend/internal/notification"
	"gostation/backend/internal/station"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Règles des rappels (spécification de l'étape 6).
const (
	MaxPerDay  = 4 // rappels par station et par jour
	MaxIgnored = 3 // rappels ignorés de suite avant l'escalade
)

// Config regroupe les réglages.
type Config struct {
	Timezone *time.Location
	// Interval : délai depuis la dernière mise à jour ou confirmation, et entre deux rappels.
	Interval time.Duration
}

// Notifier écrit les notifications et met leurs push en file (*notification.Service).
type Notifier interface {
	Create(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, t notification.Type, data map[string]any) (uuid.UUID, bool, error)
	Dispatch(ctx context.Context, ids []uuid.UUID)
}

// ScheduleLoader charge l'emploi du temps d'une station (*station.Service).
type ScheduleLoader interface {
	LoadSchedule(ctx context.Context, q *dbgen.Queries, stationID uuid.UUID) (station.Schedule, []station.Closure, error)
}

// Deps regroupe les dépendances injectées.
type Deps struct {
	Store     *store.Store
	Notifier  Notifier
	Schedules ScheduleLoader
	Mailer    mail.Mailer
	Templates *mail.Renderer
	Log       *slog.Logger
	// Clock donne l'heure courante (horloge réglable dans les tests d'intégration).
	Clock func() time.Time
}

// Service envoie les rappels.
type Service struct {
	Deps
	cfg Config
}

// NewService construit le service.
func NewService(cfg Config, d Deps) *Service {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	return &Service{Deps: d, cfg: cfg}
}

// ScanResult résume un passage.
type ScanResult struct {
	Sent      int
	Escalated int
}

// Scan envoie les rappels dus et escalade les séries ignorées.
func (s *Service) Scan(ctx context.Context) (ScanResult, error) {
	now := s.Clock()
	lc := station.ClockAt(now, s.cfg.Timezone)
	rows, err := s.Store.ListReminderCandidates(ctx, dbgen.ListReminderCandidatesParams{
		StaleBefore: now.Add(-s.cfg.Interval), Now: now, MaxIgnored: MaxIgnored, MaxPerDay: MaxPerDay,
		LocalDate: lc.Date, Isodow: lc.ISODow, LocalTime: lc.Time, PrevIsodow: lc.PrevISODow, PrevDate: lc.PrevDate,
	})
	if err != nil {
		return ScanResult{}, fmt.Errorf("reminder: list candidates: %w", err)
	}
	var res ScanResult
	var ids []uuid.UUID
	// Les rappels déjà enregistrés partent même si un passage s'interrompt sur une erreur.
	defer func() { s.Notifier.Dispatch(context.WithoutCancel(ctx), ids) }()
	for _, row := range rows {
		if row.ManagerID == nil {
			continue
		}
		if row.Streak >= MaxIgnored {
			if err := s.escalate(ctx, row, now); err != nil {
				return res, err
			}
			res.Escalated++
			continue
		}
		id, sent, err := s.remind(ctx, row, now, lc.Date)
		if err != nil {
			return res, err
		}
		if sent {
			ids = append(ids, id)
			res.Sent++
		}
	}
	if res.Sent > 0 || res.Escalated > 0 {
		s.Log.InfoContext(ctx, "reminder: scan done", slog.Int("sent", res.Sent), slog.Int("escalated", res.Escalated))
	}
	return res, nil
}

// remind écrit le rappel (boîte de réception) et met à jour l'état du jour, atomiquement.
func (s *Service) remind(ctx context.Context, row dbgen.ListReminderCandidatesRow, now time.Time, day pgtype.Date) (uuid.UUID, bool, error) {
	data := map[string]any{
		"stationId":   row.ID.String(),
		"stationName": row.Name,
		// ETag courant : l'action « Rien n'a changé » confirme avec If-Match sans recharger la
		// station ; une écriture entre-temps (412) signifie que les stocks ont déjà bougé.
		"etag": station.ETag(row.Version),
	}
	if row.LastStockUpdateAt != nil {
		data["hoursSinceUpdate"] = int(math.Floor(now.Sub(*row.LastStockUpdateAt).Hours()))
	}
	var id uuid.UUID
	var created bool
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		var err error
		if id, created, err = s.Notifier.Create(ctx, q, *row.ManagerID, notification.TypeStockReminder, data); err != nil || !created {
			return err
		}
		return q.RecordReminderSent(ctx, dbgen.RecordReminderSentParams{StationID: row.ID, LocalDate: day, Now: now})
	})
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("reminder: send: %w", err)
	}
	return id, created, nil
}

// escalate arrête les rappels pour la journée, alerte l'admin (gérant inactif) puis prévient le
// gérant par email.
func (s *Service) escalate(ctx context.Context, row dbgen.ListReminderCandidatesRow, now time.Time) error {
	details, _ := json.Marshal(map[string]any{"ignoredReminders": row.Streak})
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.StopReminders(ctx, dbgen.StopRemindersParams{StationID: row.ID, Now: now}); err != nil {
			return err
		}
		_, err := q.OpenAdminAlert(ctx, dbgen.OpenAdminAlertParams{
			Kind: dbgen.AdminAlertKindManagerInactive, StationID: row.ID, Details: details,
		})
		if store.IsNotFound(err) { // alerte déjà ouverte
			return nil
		}
		return err
	})
	if err != nil {
		return fmt.Errorf("reminder: escalate: %w", err)
	}
	contact, err := s.Store.GetStationContact(ctx, row.ID)
	if err == nil {
		var m mail.Message
		if m, err = s.Templates.StationStatus(contact.Email, contact.FirstName, contact.Name, mail.StationRemindersPaused, ""); err == nil {
			err = s.Mailer.Send(ctx, m)
		}
	}
	if err != nil {
		s.Log.ErrorContext(ctx, "reminder: paused email not sent", slog.Any("err", err))
	}
	return nil
}

// Mute met les rappels de la station du gérant en sourdine jusqu'à la fermeture du jour
// (fin de la dernière plage d'ouverture du jour, minuit à défaut).
func (s *Service) Mute(ctx context.Context, managerID uuid.UUID) (time.Time, error) {
	now := s.Clock()
	var until time.Time
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		st, err := q.GetStationByManager(ctx, &managerID)
		if err != nil {
			return store.Translate(err)
		}
		sched, _, err := s.Schedules.LoadSchedule(ctx, q, st.ID)
		if err != nil {
			return err
		}
		until = sched.DayEnd(now).UTC()
		_, err = q.MuteReminders(ctx, dbgen.MuteRemindersParams{
			StationID: st.ID, LocalDate: station.LocalDate(now, s.cfg.Timezone), MutedUntil: &until,
		})
		return err
	})
	if err != nil {
		return time.Time{}, fmt.Errorf("reminder: mute: %w", err)
	}
	return until, nil
}
