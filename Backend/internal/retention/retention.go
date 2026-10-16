// Package retention applique les durées de conservation (ARCHITECTURE §8,
// docs/legal/inventaire-donnees.md) : une tâche asynq par règle (retention:<règle>), quotidienne
// (03:00 heure locale, une minute d'écart entre deux règles), sauf les copies « mes données »
// (toutes les 15 minutes : elles ne vivent que 24 h).
//
// Chaque règle :
//   - est idempotente : elle ne touche que ce qui a dépassé sa durée, et une ligne traitée ne l'est
//     plus au passage suivant ;
//   - travaille par lots (BatchSize lignes), répétés jusqu'à épuisement : une règle interrompue
//     reprend où elle s'était arrêtée ;
//   - ne journalise que des compteurs, jamais les données supprimées ;
//   - a un comptage (make purge-dry-run) qui dit ce qu'elle ferait sans rien supprimer.
//
// Les durées viennent de la configuration (RETENTION_*), valeurs provisoires à valider par un
// juriste (D69). Les données supprimées disparaissent des sauvegardes à l'expiration de celles-ci
// (rotation définie à l'étape 10C).
package retention

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/mail"
	"gostation/backend/internal/platform/storage"
	"gostation/backend/internal/pseudonym"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// BatchSize : lignes traitées par lot.
const BatchSize = 500

// maxBatches borne un passage (500 × 2 000 = 1 million de lignes) : le reste attend le suivant.
const maxBatches = 2000

// Config regroupe les durées de conservation (config.Retention).
type Config struct {
	Timezone                *time.Location
	Notifications           time.Duration
	BackInStockAlerts       time.Duration
	DeviceTokens            time.Duration
	InactiveAccounts        time.Duration
	InactivityWarning       time.Duration
	ReportAuthors           time.Duration
	Reports                 time.Duration
	AuditLogs               time.Duration
	RejectedDocuments       time.Duration
	DeletedStationDocuments time.Duration
	StockHistory            time.Duration
	DataRequests            time.Duration
	AdminAlerts             time.Duration
	ExportRecords           time.Duration
}

// Privacy supprime les comptes inactifs et les copies « mes données » expirées (*privacy.Service).
type Privacy interface {
	EraseInactive(ctx context.Context, uid uuid.UUID) error
	CountExpiredExports(ctx context.Context, now time.Time) (int64, error)
	PurgeExportsBatch(ctx context.Context, now time.Time, batch int32) (int64, error)
}

// Mailer met un email en file (*mail.Queue).
type Mailer interface {
	Send(ctx context.Context, m mail.Message) error
}

// Deps regroupe les dépendances injectées.
type Deps struct {
	Store     *store.Store
	Storage   storage.Storage // justificatifs
	Privacy   Privacy
	Mailer    Mailer
	Templates *mail.Renderer
	// PseudonymKey : même clé que les exports admin (un auteur garde le même pseudonyme).
	PseudonymKey []byte
	Log          *slog.Logger
	Clock        func() time.Time
}

// Rule est une règle de conservation.
type Rule struct {
	Name string
	// Spec : planification cron (heure locale).
	Spec string
	// Count compte ce que la règle traiterait maintenant (simulation).
	Count func(ctx context.Context, now time.Time) (int64, error)
	// Batch traite un lot et renvoie le nombre de lignes traitées (moins de BatchSize : terminé).
	Batch func(ctx context.Context, now time.Time) (int64, error)
}

// Purger exécute les règles.
type Purger struct {
	Deps
	cfg   Config
	rules []Rule
}

// New construit le purgeur et ses règles.
func New(cfg Config, d Deps) *Purger {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	p := &Purger{Deps: d, cfg: cfg}
	p.rules = p.build()
	return p
}

// Rules renvoie les règles, dans l'ordre de leur planification.
func (p *Purger) Rules() []Rule { return p.rules }

// TaskType renvoie le type de la tâche asynq d'une règle.
func TaskType(rule string) string { return "retention:" + rule }

// Run applique une règle, lot après lot, et renvoie le nombre de lignes traitées.
func (p *Purger) Run(ctx context.Context, name string) (int64, error) {
	r, ok := p.rule(name)
	if !ok {
		return 0, fmt.Errorf("retention: unknown rule %q", name)
	}
	now := p.Clock()
	var total int64
	for range maxBatches {
		if err := ctx.Err(); err != nil {
			p.logCount(ctx, name, total)
			return total, err
		}
		n, err := r.Batch(ctx, now)
		total += n
		if err != nil {
			p.logCount(ctx, name, total)
			return total, fmt.Errorf("retention: %s: %w", name, err)
		}
		if n < BatchSize {
			break
		}
	}
	p.logCount(ctx, name, total)
	return total, nil
}

func (p *Purger) logCount(ctx context.Context, rule string, n int64) {
	if n > 0 {
		p.Log.InfoContext(ctx, "retention: purged", slog.String("rule", rule), slog.Int64("rows", n))
	}
}

// RunAll applique toutes les règles (tests) ; l'échec de l'une n'empêche pas les suivantes.
func (p *Purger) RunAll(ctx context.Context) error {
	var errs []error
	for _, r := range p.rules {
		if _, err := p.Run(ctx, r.Name); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// Simulation est le résultat d'une règle simulée.
type Simulation struct {
	Rule  string
	Count int64
}

// DryRun compte, pour chaque règle, ce qui serait traité maintenant, sans rien modifier.
func (p *Purger) DryRun(ctx context.Context) ([]Simulation, error) {
	now := p.Clock()
	out := make([]Simulation, 0, len(p.rules))
	for _, r := range p.rules {
		n, err := r.Count(ctx, now)
		if err != nil {
			return out, fmt.Errorf("retention: count %s: %w", r.Name, err)
		}
		out = append(out, Simulation{Rule: r.Name, Count: n})
	}
	return out, nil
}

func (p *Purger) rule(name string) (Rule, bool) {
	for _, r := range p.rules {
		if r.Name == name {
			return r, true
		}
	}
	return Rule{}, false
}

func daily(i int) string { return fmt.Sprintf("%d 3 * * *", i) }

func (p *Purger) build() []Rule {
	st, cfg := p.Store, p.cfg
	rules := []Rule{
		{
			Name: "notifications",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountNotificationsBefore(ctx, now.Add(-cfg.Notifications))
			},
			Batch: func(ctx context.Context, now time.Time) (int64, error) {
				return st.DeleteNotificationsBatch(ctx, dbgen.DeleteNotificationsBatchParams{Before: now.Add(-cfg.Notifications), BatchSize: BatchSize})
			},
		},
		{
			Name: "back_in_stock_alerts",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountBackInStockAlertsBefore(ctx, now.Add(-cfg.BackInStockAlerts))
			},
			Batch: func(ctx context.Context, now time.Time) (int64, error) {
				return st.DeleteBackInStockAlertsBatch(ctx, dbgen.DeleteBackInStockAlertsBatchParams{Before: now.Add(-cfg.BackInStockAlerts), BatchSize: BatchSize})
			},
		},
		{
			Name: "device_tokens",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountInactiveDevices(ctx, now.Add(-cfg.DeviceTokens))
			},
			Batch: func(ctx context.Context, now time.Time) (int64, error) {
				return st.DeleteInactiveDevicesBatch(ctx, dbgen.DeleteInactiveDevicesBatchParams{Before: now.Add(-cfg.DeviceTokens), BatchSize: BatchSize})
			},
		},
		{
			Name: "inactive_accounts_warning",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountAccountsToWarn(ctx, now.Add(-(cfg.InactiveAccounts - cfg.InactivityWarning)))
			},
			Batch: p.warnInactive,
		},
		{
			Name: "inactive_accounts",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountInactiveAccountsToDelete(ctx, dbgen.CountInactiveAccountsToDeleteParams{
					Before: now.Add(-cfg.InactiveAccounts), WarnedBefore: ptr(now.Add(-cfg.InactivityWarning)),
				})
			},
			Batch: p.deleteInactive,
		},
		{
			Name: "report_authors",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountReportsToPseudonymize(ctx, now.Add(-cfg.ReportAuthors))
			},
			Batch: p.pseudonymizeReports,
		},
		{
			Name: "reports",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountReportsBefore(ctx, now.Add(-cfg.Reports))
			},
			Batch: func(ctx context.Context, now time.Time) (int64, error) {
				return st.DeleteReportsBatch(ctx, dbgen.DeleteReportsBatchParams{Before: now.Add(-cfg.Reports), BatchSize: BatchSize})
			},
		},
		{
			Name: "audit_logs",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountAuditLogsBefore(ctx, now.Add(-cfg.AuditLogs))
			},
			Batch: func(ctx context.Context, now time.Time) (int64, error) {
				return st.DeleteAuditLogsBatch(ctx, dbgen.DeleteAuditLogsBatchParams{Before: now.Add(-cfg.AuditLogs), BatchSize: BatchSize})
			},
		},
		{
			Name: "station_documents",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountDocumentsToDelete(ctx, dbgen.CountDocumentsToDeleteParams{
					RejectedBefore: now.Add(-cfg.RejectedDocuments), ManagerDeletedBefore: ptr(now.Add(-cfg.DeletedStationDocuments)),
				})
			},
			Batch: p.deleteDocuments,
		},
		{
			Name: "stock_history",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountStockHistoryBefore(ctx, now.Add(-cfg.StockHistory))
			},
			Batch: func(ctx context.Context, now time.Time) (int64, error) {
				return st.AggregateStockHistoryBatch(ctx, dbgen.AggregateStockHistoryBatchParams{
					Before: now.Add(-cfg.StockHistory), BatchSize: BatchSize, Timezone: cfg.Timezone.String(),
				})
			},
		},
		{
			Name: "data_requests",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountClosedDataRequestsBefore(ctx, ptr(now.Add(-cfg.DataRequests)))
			},
			Batch: func(ctx context.Context, now time.Time) (int64, error) {
				return st.DeleteClosedDataRequestsBatch(ctx, dbgen.DeleteClosedDataRequestsBatchParams{Before: ptr(now.Add(-cfg.DataRequests)), BatchSize: BatchSize})
			},
		},
		{
			Name: "admin_alerts",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountResolvedAdminAlertsBefore(ctx, ptr(now.Add(-cfg.AdminAlerts)))
			},
			Batch: func(ctx context.Context, now time.Time) (int64, error) {
				return st.DeleteResolvedAdminAlertsBatch(ctx, dbgen.DeleteResolvedAdminAlertsBatchParams{Before: ptr(now.Add(-cfg.AdminAlerts)), BatchSize: BatchSize})
			},
		},
		{
			Name: "export_records",
			Count: func(ctx context.Context, now time.Time) (int64, error) {
				return st.CountExportRecordsBefore(ctx, now.Add(-cfg.ExportRecords))
			},
			Batch: func(ctx context.Context, now time.Time) (int64, error) {
				return st.DeleteExportRecordsBatch(ctx, dbgen.DeleteExportRecordsBatchParams{Before: now.Add(-cfg.ExportRecords), BatchSize: BatchSize})
			},
		},
	}
	for i := range rules {
		rules[i].Spec = daily(i)
	}
	return append(rules, Rule{
		Name: "personal_exports", Spec: "*/15 * * * *",
		Count: func(ctx context.Context, now time.Time) (int64, error) {
			return p.Privacy.CountExpiredExports(ctx, now)
		},
		Batch: func(ctx context.Context, now time.Time) (int64, error) {
			return p.Privacy.PurgeExportsBatch(ctx, now, BatchSize)
		},
	})
}

// warnInactive prévient par email les comptes inactifs, 30 jours avant leur suppression.
func (p *Purger) warnInactive(ctx context.Context, now time.Time) (int64, error) {
	rows, err := p.Store.ListAccountsToWarn(ctx, dbgen.ListAccountsToWarnParams{
		Before: now.Add(-(p.cfg.InactiveAccounts - p.cfg.InactivityWarning)), BatchSize: BatchSize,
	})
	if err != nil {
		return 0, err
	}
	var n int64
	for _, r := range rows {
		// Jamais moins de 30 jours entre l'avertissement et la suppression.
		deletion := r.LastActiveAt.Add(p.cfg.InactiveAccounts)
		if earliest := now.Add(p.cfg.InactivityWarning); deletion.Before(earliest) {
			deletion = earliest
		}
		m, err := p.Templates.InactivityWarning(r.Email, r.FirstName, p.cfg.InactiveAccounts, deletion)
		if err != nil {
			return n, err
		}
		if err := p.Mailer.Send(ctx, m); err != nil {
			return n, err
		}
		if _, err := p.Store.MarkInactivityWarned(ctx, dbgen.MarkInactivityWarnedParams{ID: r.ID, Now: &now}); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// deleteInactive supprime (anonymise) les comptes inactifs prévenus depuis 30 jours au moins.
func (p *Purger) deleteInactive(ctx context.Context, now time.Time) (int64, error) {
	rows, err := p.Store.ListInactiveAccountsToDelete(ctx, dbgen.ListInactiveAccountsToDeleteParams{
		Before: now.Add(-p.cfg.InactiveAccounts), WarnedBefore: ptr(now.Add(-p.cfg.InactivityWarning)), BatchSize: BatchSize,
	})
	if err != nil {
		return 0, err
	}
	var n int64
	for _, r := range rows {
		if err := p.Privacy.EraseInactive(ctx, r.ID); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// pseudonymizeReports remplace l'auteur des signalements de plus de 90 jours par son pseudonyme.
func (p *Purger) pseudonymizeReports(ctx context.Context, now time.Time) (int64, error) {
	rows, err := p.Store.ListReportsToPseudonymize(ctx, dbgen.ListReportsToPseudonymizeParams{
		Before: now.Add(-p.cfg.ReportAuthors), BatchSize: BatchSize,
	})
	if err != nil || len(rows) == 0 {
		return 0, err
	}
	ids, names := make([]uuid.UUID, 0, len(rows)), make([]string, 0, len(rows))
	for _, r := range rows {
		if r.ReporterID == nil {
			continue
		}
		ids = append(ids, r.ID)
		names = append(names, pseudonym.Of(p.PseudonymKey, *r.ReporterID))
	}
	if _, err := p.Store.PseudonymizeReports(ctx, dbgen.PseudonymizeReportsParams{Now: &now, Ids: ids, Pseudonyms: names}); err != nil {
		return 0, err
	}
	return int64(len(rows)), nil
}

// deleteDocuments supprime les justificatifs arrivés au terme de leur conservation (fichier, puis
// références en base).
func (p *Purger) deleteDocuments(ctx context.Context, now time.Time) (int64, error) {
	rows, err := p.Store.ListDocumentsToDelete(ctx, dbgen.ListDocumentsToDeleteParams{
		RejectedBefore: now.Add(-p.cfg.RejectedDocuments), ManagerDeletedBefore: ptr(now.Add(-p.cfg.DeletedStationDocuments)),
		BatchSize: BatchSize,
	})
	if err != nil {
		return 0, err
	}
	var n int64
	for _, r := range rows {
		if r.DocumentObjectKey == nil {
			continue
		}
		if err := p.Storage.Delete(ctx, *r.DocumentObjectKey); err != nil && !errors.Is(err, storage.ErrNotFound) {
			return n, err
		}
		if _, err := p.Store.ClearStationDocument(ctx, dbgen.ClearStationDocumentParams{
			ID: r.ID, ObjectKey: r.DocumentObjectKey, Now: &now,
		}); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func ptr[T any](v T) *T { return &v }
