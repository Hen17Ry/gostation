// Package report gère les signalements des utilisateurs vérifiés (rupture d'un produit, station
// fermée, position incorrecte, autre), leurs effets collectifs et leur modération.
//
// Effets, par cause (station + motif, + produit pour une rupture), comptés en auteurs distincts
// sur 2 h parmi les signalements ouverts :
//   - 3 : badge « signalé » dans la recherche et la fiche, notification au gérant (sans l'identité
//     des auteurs) ;
//   - 5 : exclusion de la recherche (du produit, ou de toute la station pour les autres motifs),
//     alerte admin, notification au gérant.
//
// Clôture automatique (station.closeReports) : une mise à jour ou une confirmation des stocks clôt
// les ruptures des produits concernés et « station fermée » ; un changement de position clôt
// « position incorrecte » ; « autre » ne se clôt que par l'admin. Les effets des causes closes sont
// levés. Pour une rupture ou une fermeture, l'auteur doit être à 2 km au plus : sa position ne sert
// qu'à ce contrôle, elle n'est ni stockée ni journalisée.
package report

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/notification"
	"gostation/backend/internal/platform/h3"
	"gostation/backend/internal/station"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Codes d'erreur stables (docs/ARCHITECTURE.md §5).
const (
	CodeTooFar             = "report.too_far"
	CodeDuplicate          = "report.duplicate"
	CodeDailyLimit         = "report.daily_limit"
	CodeReportingSuspended = "report.reporting_suspended"
)

// Règles (spécification de l'étape 6).
const (
	MaxDistanceM     = 2000          // rupture et fermeture : auteur à 2 km de la station au plus
	Window           = 2 * time.Hour // fenêtre des seuils, et un signalement par cause et par auteur
	DailyLimit       = 10            // signalements par auteur et par jour (journée locale)
	FlagThreshold    = 3             // badge « signalé »
	ExcludeThreshold = 5             // exclusion de la recherche
	MaxCommentRunes  = 300
)

// Motifs (enum report_reason).
const (
	ReasonOutOfStock    = string(dbgen.ReportReasonOutOfStock)
	ReasonStationClosed = string(dbgen.ReportReasonStationClosed)
	ReasonWrongLocation = string(dbgen.ReportReasonWrongLocation)
	ReasonOther         = string(dbgen.ReportReasonOther)
)

// Notifier écrit les notifications et met leurs push en file (*notification.Service).
type Notifier interface {
	Create(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, t notification.Type, data map[string]any) (uuid.UUID, bool, error)
	Dispatch(ctx context.Context, ids []uuid.UUID)
}

// CacheInvalidator invalide le cache de recherche (*searchcache.Invalidator).
type CacheInvalidator interface {
	Products(ctx context.Context, ids ...int16) error
	All(ctx context.Context) error
}

// Config regroupe les réglages.
type Config struct {
	Timezone *time.Location
}

// Deps regroupe les dépendances injectées.
type Deps struct {
	Store    *store.Store
	Notifier Notifier
	Cache    CacheInvalidator
	Audit    *audit.Logger
	Log      *slog.Logger
}

// Service expose les signalements.
type Service struct {
	Deps
	cfg Config
	now func() time.Time
}

// NewService construit le service.
func NewService(cfg Config, d Deps) *Service {
	return &Service{Deps: d, cfg: cfg, now: time.Now}
}

// Position est la position de l'auteur, utilisée en mémoire pour le contrôle des 2 km.
type Position struct {
	Lat, Lng float64
}

// Input est un signalement (POST /stations/{id}/reports).
type Input struct {
	Reason    string
	ProductID *int16
	Comment   *string
	Position  *Position
}

// Report est un signalement enregistré.
type Report struct {
	ID        uuid.UUID
	Reason    string
	ProductID *int16
	Status    string
	CreatedAt time.Time
}

func needsPosition(reason string) bool {
	return reason == ReasonOutOfStock || reason == ReasonStationClosed
}

// validate contrôle la saisie et normalise le commentaire. Les messages d'erreur ne reprennent
// jamais la position.
func validate(in *Input) error {
	var f []apperr.FieldError
	switch in.Reason {
	case ReasonOutOfStock, ReasonStationClosed, ReasonWrongLocation, ReasonOther:
	default:
		f = append(f, apperr.FieldError{Field: "reason", Code: "invalid", Message: "must be out_of_stock, station_closed, wrong_location or other"})
	}
	switch {
	case in.Reason == ReasonOutOfStock && in.ProductID == nil:
		f = append(f, apperr.FieldError{Field: "productId", Code: "required", Message: "is required for out_of_stock"})
	case in.Reason != ReasonOutOfStock && in.ProductID != nil:
		f = append(f, apperr.FieldError{Field: "productId", Code: "not_allowed", Message: "is only allowed for out_of_stock"})
	}
	if in.Comment != nil {
		c := strings.TrimSpace(*in.Comment)
		if c == "" {
			in.Comment = nil
		} else {
			in.Comment = &c
		}
	}
	switch {
	case in.Comment != nil && utf8.RuneCountInString(*in.Comment) > MaxCommentRunes:
		f = append(f, apperr.FieldError{Field: "comment", Code: "too_long", Message: fmt.Sprintf("must be at most %d characters", MaxCommentRunes)})
	case in.Reason == ReasonOther && in.Comment == nil:
		f = append(f, apperr.FieldError{Field: "comment", Code: "required", Message: "is required for other"})
	}
	if needsPosition(in.Reason) {
		p := in.Position
		switch {
		case p == nil:
			f = append(f, apperr.FieldError{Field: "position", Code: "required", Message: "is required for out_of_stock and station_closed"})
		case math.IsNaN(p.Lat) || p.Lat < -90 || p.Lat > 90 || math.IsNaN(p.Lng) || p.Lng < -180 || p.Lng > 180:
			f = append(f, apperr.FieldError{Field: "position", Code: "out_of_range", Message: "lat must be within ±90 and lng within ±180"})
		}
	}
	if len(f) > 0 {
		return apperr.Validation(f...)
	}
	return nil
}

// effect décrit le franchissement d'un seuil par la cause d'un signalement.
type effect struct {
	reason       string
	productID    *int16
	productLabel string
	reporters    int
	flagged      bool // seuil 3 franchi par ce signalement
	excluded     bool // seuil 5 franchi par ce signalement
	notification uuid.UUID
}

// Create enregistre un signalement et applique ses effets.
func (s *Service) Create(ctx context.Context, reporterID, stationID uuid.UUID, in Input) (Report, error) {
	if err := validate(&in); err != nil {
		return Report{}, err
	}
	banned, err := s.Store.GetReportingBan(ctx, reporterID)
	if err != nil {
		return Report{}, fmt.Errorf("report: load reporter: %w", store.Translate(err))
	}
	if banned != nil {
		return Report{}, apperr.New(http.StatusForbidden, CodeReportingSuspended, "Your right to report has been withdrawn.")
	}
	target, err := s.Store.GetReportTarget(ctx, stationID)
	if err != nil {
		return Report{}, fmt.Errorf("report: load station: %w", store.Translate(err))
	}
	if needsPosition(in.Reason) {
		far := target.Lat == nil || target.Lng == nil ||
			h3.Haversine(in.Position.Lat, in.Position.Lng, *target.Lat, *target.Lng) > MaxDistanceM
		if far {
			return Report{}, apperr.New(http.StatusUnprocessableEntity, CodeTooFar,
				fmt.Sprintf("You must be within %d m of the station to report this.", MaxDistanceM))
		}
	}
	in.Position = nil // contrôle fait : la position n'est plus utilisée
	if in.Reason == ReasonOutOfStock {
		sells, err := s.Store.StationSellsProduct(ctx, dbgen.StationSellsProductParams{StationID: stationID, ProductID: *in.ProductID})
		if err != nil {
			return Report{}, fmt.Errorf("report: check product: %w", err)
		}
		if !sells {
			return Report{}, apperr.Validation(apperr.FieldError{Field: "productId", Code: "not_sold", Message: "is not a product sold by this station"})
		}
	}

	now := s.now()
	reason := dbgen.ReportReason(in.Reason)
	var rep Report
	var eff effect
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		// Limites par auteur, sérialisées par auteur ; seuils sérialisés par station.
		if err := q.AdvisoryLock(ctx, "report:user:"+reporterID.String()); err != nil {
			return err
		}
		dup, err := q.CountRecentReportsForCause(ctx, dbgen.CountRecentReportsForCauseParams{
			ReporterID: &reporterID, StationID: stationID, Reason: reason, ProductID: in.ProductID, Since: now.Add(-Window),
		})
		if err != nil {
			return err
		}
		if dup > 0 {
			return apperr.New(http.StatusConflict, CodeDuplicate, "You already reported this less than 2 hours ago.")
		}
		today, err := q.CountReportsSince(ctx, dbgen.CountReportsSinceParams{
			ReporterID: &reporterID, Since: station.DayStart(now, s.cfg.Timezone),
		})
		if err != nil {
			return err
		}
		if today >= DailyLimit {
			return apperr.New(http.StatusTooManyRequests, CodeDailyLimit, fmt.Sprintf("You can send at most %d reports per day.", DailyLimit))
		}
		if err := q.AdvisoryLock(ctx, "report:station:"+stationID.String()); err != nil {
			return err
		}
		row, err := q.InsertReport(ctx, dbgen.InsertReportParams{
			StationID: stationID, ProductID: in.ProductID, ReporterID: &reporterID, Reason: reason, Comment: in.Comment,
		})
		if err != nil {
			return err
		}
		rep = Report{ID: row.ID, Reason: in.Reason, ProductID: in.ProductID, Status: string(row.Status), CreatedAt: row.CreatedAt}
		eff, err = s.applyThresholds(ctx, q, target, reason, in.ProductID, now)
		return err
	})
	if err != nil {
		return Report{}, fmt.Errorf("report: create: %w", err)
	}
	s.publish(ctx, eff)
	return rep, nil
}

// applyThresholds compte les auteurs distincts de la cause sur la fenêtre et pose ou aggrave son
// effet ; au franchissement d'un seuil : notification au gérant, et alerte admin au seuil 5.
func (s *Service) applyThresholds(ctx context.Context, q *dbgen.Queries, target dbgen.GetReportTargetRow,
	reason dbgen.ReportReason, productID *int16, now time.Time,
) (effect, error) {
	eff := effect{reason: string(reason), productID: productID}
	count, err := q.CountReportersForCause(ctx, dbgen.CountReportersForCauseParams{
		StationID: target.ID, Reason: reason, ProductID: productID, Since: now.Add(-Window),
	})
	if err != nil {
		return eff, err
	}
	eff.reporters = int(count)
	reporters := int16(min(count, math.MaxInt16)) //nolint:gosec // borné
	var excludedAt *time.Time
	if count >= ExcludeThreshold {
		excludedAt = &now
	}
	flag, err := q.GetReportFlag(ctx, dbgen.GetReportFlagParams{StationID: target.ID, Reason: reason, ProductID: productID})
	switch {
	case store.IsNotFound(err):
		if count < FlagThreshold {
			return eff, nil
		}
		eff.flagged, eff.excluded = true, excludedAt != nil
		err = q.InsertReportFlag(ctx, dbgen.InsertReportFlagParams{
			StationID: target.ID, Reason: reason, ProductID: productID, Reporters: reporters, ExcludedAt: excludedAt,
		})
	case err != nil:
		return eff, err
	case reporters > flag.Reporters:
		if flag.ExcludedAt != nil {
			excludedAt = flag.ExcludedAt
		} else {
			eff.excluded = excludedAt != nil
		}
		err = q.UpdateReportFlag(ctx, dbgen.UpdateReportFlagParams{ID: flag.ID, Reporters: reporters, ExcludedAt: excludedAt})
	}
	if err != nil || (!eff.flagged && !eff.excluded) {
		return eff, err
	}

	if productID != nil {
		if eff.productLabel, err = productLabel(ctx, q, *productID); err != nil {
			return eff, err
		}
	}
	if eff.excluded {
		details, _ := json.Marshal(map[string]any{"reporters": eff.reporters})
		_, err := q.OpenAdminAlert(ctx, dbgen.OpenAdminAlertParams{
			Kind: dbgen.AdminAlertKindReportsThreshold, StationID: target.ID, Reason: &reason, ProductID: productID, Details: details,
		})
		if err != nil && !store.IsNotFound(err) { // IsNotFound : alerte déjà ouverte
			return eff, err
		}
	}
	if target.ManagerID != nil {
		level := notification.LevelFlagged
		if eff.excluded {
			level = notification.LevelExcluded
		}
		data := map[string]any{
			"stationId": target.ID.String(), "stationName": target.Name, "reason": eff.reason,
			"reporters": eff.reporters, "level": level,
		}
		if productID != nil {
			data["productId"], data["productLabel"] = *productID, eff.productLabel
		}
		id, created, err := s.Notifier.Create(ctx, q, *target.ManagerID, notification.TypeStationReported, data)
		if err != nil {
			return eff, err
		}
		if created {
			eff.notification = id
		}
	}
	return eff, nil
}

func productLabel(ctx context.Context, q *dbgen.Queries, id int16) (string, error) {
	rows, err := q.ListActiveProducts(ctx)
	if err != nil {
		return "", err
	}
	for _, p := range rows {
		if p.ID == id {
			return p.LabelFr, nil
		}
	}
	return "", nil
}

// publish applique, après le commit, ce qu'un effet change hors de la base : cache de recherche
// (badge ou exclusion) et push au gérant.
func (s *Service) publish(ctx context.Context, eff effect) {
	if !eff.flagged && !eff.excluded {
		return
	}
	s.invalidate(ctx, eff.productID)
	if eff.notification != uuid.Nil {
		s.Notifier.Dispatch(ctx, []uuid.UUID{eff.notification})
	}
}

// invalidate invalide le cache du produit (rupture) ou de toute la station (autres motifs).
func (s *Service) invalidate(ctx context.Context, productID *int16) {
	var err error
	if productID != nil {
		err = s.Cache.Products(ctx, *productID)
	} else {
		err = s.Cache.All(ctx)
	}
	if err != nil {
		s.Log.WarnContext(ctx, "report: search cache invalidation failed", slog.Any("err", err))
	}
}

// ── Vue gérant ──────────────────────────────────────────────────────────────

// Flag est l'effet en cours d'une cause (badge, ou exclusion de la recherche).
type Flag struct {
	Reason       string
	ProductID    *int16
	ProductLabel *string
	Reporters    int
	FlaggedAt    time.Time
	ExcludedAt   *time.Time
}

// ManagerReport est un signalement vu par le gérant : jamais l'auteur ni son commentaire.
type ManagerReport struct {
	ID           uuid.UUID
	Reason       string
	ProductID    *int16
	ProductLabel *string
	Status       string
	CreatedAt    time.Time
	ResolvedAt   *time.Time
}

// ManagerPage est la vue gérant des signalements.
type ManagerPage struct {
	Flags      []Flag
	Items      []ManagerReport
	NextCursor string
}

// Flags renvoie les effets en cours sur une station (fiche publique, vue gérant).
func (s *Service) Flags(ctx context.Context, stationID uuid.UUID) ([]Flag, error) {
	rows, err := s.Store.ListStationReportFlags(ctx, stationID)
	if err != nil {
		return nil, fmt.Errorf("report: list flags: %w", err)
	}
	out := make([]Flag, 0, len(rows))
	for _, f := range rows {
		out = append(out, Flag{
			Reason: string(f.Reason), ProductID: f.ProductID, ProductLabel: f.ProductLabel,
			Reporters: int(f.Reporters), FlaggedAt: f.FlaggedAt, ExcludedAt: f.ExcludedAt,
		})
	}
	return out, nil
}

func parseCursor(cursor string) (*uuid.UUID, error) {
	if cursor == "" {
		return nil, nil
	}
	id, err := uuid.Parse(cursor)
	if err != nil {
		return nil, apperr.BadRequest(apperr.CodeInvalidParameter, "Invalid cursor.")
	}
	return &id, nil
}

func pageSize(limit int) (int, error) {
	if limit <= 0 {
		return 20, nil
	}
	if limit > 100 {
		return 0, apperr.Validation(apperr.FieldError{Field: "limit", Code: "out_of_range", Message: "must be between 1 and 100"})
	}
	return limit, nil
}

// ManagerReports renvoie les signalements de la station du gérant (ouverts seulement par défaut).
func (s *Service) ManagerReports(ctx context.Context, managerID uuid.UUID, openOnly bool, cursor string, limit int) (ManagerPage, error) {
	n, err := pageSize(limit)
	if err != nil {
		return ManagerPage{}, err
	}
	cur, err := parseCursor(cursor)
	if err != nil {
		return ManagerPage{}, err
	}
	st, err := s.Store.GetStationByManager(ctx, &managerID)
	if err != nil {
		return ManagerPage{}, fmt.Errorf("report: load manager station: %w", store.Translate(err))
	}
	flags, err := s.Flags(ctx, st.ID)
	if err != nil {
		return ManagerPage{}, err
	}
	rows, err := s.Store.ListStationReports(ctx, dbgen.ListStationReportsParams{
		StationID: st.ID, OpenOnly: openOnly, Cursor: cur, PageSize: int32(n + 1), //nolint:gosec // ≤ 101
	})
	if err != nil {
		return ManagerPage{}, fmt.Errorf("report: list station reports: %w", err)
	}
	page := ManagerPage{Flags: flags, Items: make([]ManagerReport, 0, min(len(rows), n))}
	for i, r := range rows {
		if i == n {
			page.NextCursor = rows[n-1].ID.String()
			break
		}
		page.Items = append(page.Items, ManagerReport{
			ID: r.ID, Reason: string(r.Reason), ProductID: r.ProductID, ProductLabel: r.ProductLabel,
			Status: string(r.Status), CreatedAt: r.CreatedAt, ResolvedAt: r.ResolvedAt,
		})
	}
	return page, nil
}
