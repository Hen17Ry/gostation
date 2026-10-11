package report

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Actor identifie l'admin à l'origine d'une décision.
type Actor struct {
	UserID uuid.UUID
	Role   string
}

// maxNoteRunes borne les notes de modération et les motifs de retrait.
const maxNoteRunes = 500

func note(field string, v *string, required bool) (*string, error) {
	if v != nil {
		t := strings.TrimSpace(*v)
		if t == "" {
			v = nil
		} else {
			v = &t
		}
	}
	switch {
	case v == nil && required:
		return nil, apperr.Validation(apperr.FieldError{Field: field, Code: "required", Message: "is required"})
	case v != nil && utf8.RuneCountInString(*v) > maxNoteRunes:
		return nil, apperr.Validation(apperr.FieldError{Field: field, Code: "too_long", Message: fmt.Sprintf("must be at most %d characters", maxNoteRunes)})
	}
	return v, nil
}

func (s *Service) audit(ctx context.Context, a Actor, action, entityType, entityID string, meta map[string]any) {
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &a.UserID, ActorRole: a.Role, Action: action,
		EntityType: entityType, EntityID: entityID, Metadata: meta,
	})
}

// ── Signalements ────────────────────────────────────────────────────────────

// AdminFilter filtre la liste admin des signalements.
type AdminFilter struct {
	Status    string // open | resolved | dismissed ; vide = tous
	StationID *uuid.UUID
	Cursor    string
	Limit     int
}

// AdminPage est une page de la liste admin.
type AdminPage struct {
	Items      []dbgen.ListReportsForAdminRow
	NextCursor string
}

// AdminList liste les signalements, les plus récents d'abord, avec leur auteur (pour la
// modération : nombre de signalements classés abusifs, retrait du droit de signaler).
func (s *Service) AdminList(ctx context.Context, f AdminFilter) (AdminPage, error) {
	n, err := pageSize(f.Limit)
	if err != nil {
		return AdminPage{}, err
	}
	cur, err := parseCursor(f.Cursor)
	if err != nil {
		return AdminPage{}, err
	}
	p := dbgen.ListReportsForAdminParams{StationID: f.StationID, Cursor: cur, PageSize: int32(n + 1)} //nolint:gosec // ≤ 101
	if f.Status != "" {
		st := dbgen.ReportStatus(f.Status)
		if !st.Valid() {
			return AdminPage{}, apperr.Validation(apperr.FieldError{Field: "status", Code: "invalid", Message: "must be open, resolved or dismissed"})
		}
		p.Status = &st
	}
	rows, err := s.Store.ListReportsForAdmin(ctx, p)
	if err != nil {
		return AdminPage{}, fmt.Errorf("report: admin list: %w", err)
	}
	page := AdminPage{Items: rows}
	if len(rows) > n {
		page.Items = rows[:n]
		page.NextCursor = rows[n-1].ID.String()
	}
	return page, nil
}

// adminReport relit un signalement dans le format de la liste admin.
func (s *Service) adminReport(ctx context.Context, id uuid.UUID) (dbgen.ListReportsForAdminRow, error) {
	r, err := s.Store.GetReportForAdmin(ctx, id)
	if err != nil {
		return dbgen.ListReportsForAdminRow{}, fmt.Errorf("report: reload: %w", store.Translate(err))
	}
	return dbgen.ListReportsForAdminRow(r), nil
}

// Resolve marque un signalement comme traité (fondé). Ses effets restent tant que la cause n'est
// pas corrigée : saisie ou confirmation des stocks (rupture, fermeture), changement de position
// (position incorrecte). « Autre » n'a pas de correction automatique : le traiter vaut correction,
// et son effet est recalculé sur les signalements encore ouverts, comme pour un classement.
func (s *Service) Resolve(ctx context.Context, a Actor, id uuid.UUID, rawNote *string) (dbgen.ListReportsForAdminRow, error) {
	n, err := note("note", rawNote, false)
	if err != nil {
		return dbgen.ListReportsForAdminRow{}, err
	}
	var changed bool
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		r, err := q.GetReportForUpdate(ctx, id)
		if err != nil {
			return store.Translate(err)
		}
		if r.Status != dbgen.ReportStatusOpen {
			return apperr.Conflict("The report has already been handled.")
		}
		if err := q.DecideReport(ctx, dbgen.DecideReportParams{ID: id, Status: dbgen.ReportStatusResolved, ResolvedBy: &a.UserID, Note: n}); err != nil {
			return err
		}
		if string(r.Reason) != ReasonOther {
			return nil
		}
		if err := q.AdvisoryLock(ctx, "report:station:"+r.StationID.String()); err != nil {
			return err
		}
		changed, err = recompute(ctx, q, r)
		return err
	})
	if err != nil {
		return dbgen.ListReportsForAdminRow{}, fmt.Errorf("report: resolve: %w", err)
	}
	if changed {
		s.invalidate(ctx, nil)
	}
	s.audit(ctx, a, audit.ActionReportResolved, "report", id.String(), nil)
	return s.adminReport(ctx, id)
}

// Dismiss classe un signalement sans suite (abusive : classé abusif). L'effet de sa cause est
// recalculé sur les signalements encore ouverts : il baisse ou disparaît sous les seuils.
func (s *Service) Dismiss(ctx context.Context, a Actor, id uuid.UUID, abusive bool, rawNote *string) (dbgen.ListReportsForAdminRow, error) {
	n, err := note("note", rawNote, false)
	if err != nil {
		return dbgen.ListReportsForAdminRow{}, err
	}
	var changed bool
	var productID *int16
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		r, err := q.GetReportForUpdate(ctx, id)
		if err != nil {
			return store.Translate(err)
		}
		if r.Status != dbgen.ReportStatusOpen {
			return apperr.Conflict("The report has already been handled.")
		}
		productID = r.ProductID
		if err := q.AdvisoryLock(ctx, "report:station:"+r.StationID.String()); err != nil {
			return err
		}
		if err := q.DecideReport(ctx, dbgen.DecideReportParams{
			ID: id, Status: dbgen.ReportStatusDismissed, Abusive: abusive, ResolvedBy: &a.UserID, Note: n,
		}); err != nil {
			return err
		}
		changed, err = recompute(ctx, q, r)
		return err
	})
	if err != nil {
		return dbgen.ListReportsForAdminRow{}, fmt.Errorf("report: dismiss: %w", err)
	}
	if changed {
		s.invalidate(ctx, productID)
	}
	s.audit(ctx, a, audit.ActionReportDismissed, "report", id.String(), map[string]any{"abusive": abusive})
	return s.adminReport(ctx, id)
}

// recompute ajuste l'effet d'une cause aux auteurs distincts de ses signalements encore ouverts.
func recompute(ctx context.Context, q *dbgen.Queries, r dbgen.GetReportForUpdateRow) (bool, error) {
	flag, err := q.GetReportFlag(ctx, dbgen.GetReportFlagParams{StationID: r.StationID, Reason: r.Reason, ProductID: r.ProductID})
	if store.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	count, err := q.CountOpenReportersForCause(ctx, dbgen.CountOpenReportersForCauseParams{
		StationID: r.StationID, Reason: r.Reason, ProductID: r.ProductID,
	})
	if err != nil {
		return false, err
	}
	switch {
	case count < FlagThreshold:
		return true, q.DeleteReportFlag(ctx, flag.ID)
	case count < ExcludeThreshold && flag.ExcludedAt != nil:
		return true, q.UpdateReportFlag(ctx, dbgen.UpdateReportFlagParams{ID: flag.ID, Reporters: int16(count), ExcludedAt: nil}) //nolint:gosec // < 5
	default:
		return false, nil
	}
}

// ── Droit de signaler ───────────────────────────────────────────────────────

// Ban retire le droit de signaler à un utilisateur (après abus), avec un motif. Les admins ne sont
// pas concernés.
func (s *Service) Ban(ctx context.Context, a Actor, userID uuid.UUID, rawReason *string) error {
	reason, err := note("reason", rawReason, true)
	if err != nil {
		return err
	}
	n, err := s.Store.SetReportingBan(ctx, dbgen.SetReportingBanParams{ID: userID, Reason: reason})
	if err != nil {
		return fmt.Errorf("report: ban: %w", err)
	}
	if n == 0 {
		return apperr.NotFound("User not found.")
	}
	s.audit(ctx, a, audit.ActionReportingBanned, "user", userID.String(), map[string]any{"reason": *reason})
	return nil
}

// Unban rend le droit de signaler, avec un motif (étape 7).
func (s *Service) Unban(ctx context.Context, a Actor, userID uuid.UUID, rawReason *string) error {
	reason, err := note("reason", rawReason, true)
	if err != nil {
		return err
	}
	n, err := s.Store.ClearReportingBan(ctx, userID)
	if err != nil {
		return fmt.Errorf("report: unban: %w", err)
	}
	if n == 0 {
		return apperr.NotFound("User not found.")
	}
	s.audit(ctx, a, audit.ActionReportingUnbanned, "user", userID.String(), map[string]any{"reason": *reason})
	return nil
}

// ── Alertes admin ───────────────────────────────────────────────────────────

// Alert est une alerte admin (gérant inactif, seuil de signalements).
type Alert struct {
	ID           uuid.UUID
	Kind         string
	StationID    uuid.UUID
	StationName  string
	Reason       *string
	ProductID    *int16
	ProductLabel *string
	Details      json.RawMessage
	CreatedAt    time.Time
	ResolvedAt   *time.Time
	ResolvedBy   *uuid.UUID
	Resolution   *string
}

// AlertFilter filtre la liste des alertes.
type AlertFilter struct {
	Status string // open (défaut) | resolved | all
	Kind   string
	Cursor string
	Limit  int
}

// AlertPage est une page d'alertes.
type AlertPage struct {
	Items      []Alert
	NextCursor string
}

func toAlert(r dbgen.ListAdminAlertsRow) Alert {
	a := Alert{
		ID: r.ID, Kind: string(r.Kind), StationID: r.StationID, StationName: r.StationName, ProductID: r.ProductID,
		ProductLabel: r.ProductLabel, Details: r.Details, CreatedAt: r.CreatedAt, ResolvedAt: r.ResolvedAt,
		ResolvedBy: r.ResolvedBy, Resolution: r.Resolution,
	}
	if r.Reason != nil {
		reason := string(*r.Reason)
		a.Reason = &reason
	}
	return a
}

// Alerts liste les alertes, les plus récentes d'abord.
func (s *Service) Alerts(ctx context.Context, f AlertFilter) (AlertPage, error) {
	n, err := pageSize(f.Limit)
	if err != nil {
		return AlertPage{}, err
	}
	cur, err := parseCursor(f.Cursor)
	if err != nil {
		return AlertPage{}, err
	}
	p := dbgen.ListAdminAlertsParams{Cursor: cur, PageSize: int32(n + 1)} //nolint:gosec // ≤ 101
	switch f.Status {
	case "", "open":
		open := true
		p.Open = &open
	case "resolved":
		open := false
		p.Open = &open
	case "all":
	default:
		return AlertPage{}, apperr.Validation(apperr.FieldError{Field: "status", Code: "invalid", Message: "must be open, resolved or all"})
	}
	if f.Kind != "" {
		k := dbgen.AdminAlertKind(f.Kind)
		if !k.Valid() {
			return AlertPage{}, apperr.Validation(apperr.FieldError{Field: "kind", Code: "invalid", Message: "must be manager_inactive or reports_threshold"})
		}
		p.Kind = &k
	}
	rows, err := s.Store.ListAdminAlerts(ctx, p)
	if err != nil {
		return AlertPage{}, fmt.Errorf("report: list alerts: %w", err)
	}
	page := AlertPage{Items: make([]Alert, 0, min(len(rows), n))}
	for i, r := range rows {
		if i == n {
			page.NextCursor = rows[n-1].ID.String()
			break
		}
		page.Items = append(page.Items, toAlert(r))
	}
	return page, nil
}

// ResolveAlert clôt une alerte.
func (s *Service) ResolveAlert(ctx context.Context, a Actor, id uuid.UUID, rawNote *string) (Alert, error) {
	n, err := note("note", rawNote, false)
	if err != nil {
		return Alert{}, err
	}
	rows, err := s.Store.ResolveAdminAlert(ctx, dbgen.ResolveAdminAlertParams{ID: id, ResolvedBy: &a.UserID, Resolution: n})
	if err != nil {
		return Alert{}, fmt.Errorf("report: resolve alert: %w", err)
	}
	r, err := s.Store.GetAdminAlert(ctx, id)
	if err != nil {
		return Alert{}, fmt.Errorf("report: load alert: %w", store.Translate(err))
	}
	if rows == 0 {
		return Alert{}, apperr.Conflict("The alert is already resolved.")
	}
	s.audit(ctx, a, audit.ActionAlertResolved, "admin_alert", id.String(), map[string]any{"kind": string(r.Kind)})
	return toAlert(dbgen.ListAdminAlertsRow(r)), nil
}
