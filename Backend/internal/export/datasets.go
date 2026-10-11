package export

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"gostation/backend/internal/platform/h3"
	"gostation/backend/internal/store/dbgen"
)

// kAnonymity : une ligne de stats n'est exportée qu'avec au moins 5 recherches (même seuil que les
// écrans admin).
const kAnonymity = 5

// fetchLimit lit une ligne de plus que MaxRows pour détecter un export trop volumineux.
const fetchLimit = MaxRows + 1

// pseudonym remplace l'auteur d'un signalement par un identifiant stable mais non réversible sans
// la clé (on repère les auteurs récurrents sans exposer leur compte).
func (s *Service) pseudonym(id *uuid.UUID) *string {
	if id == nil {
		return nil // compte supprimé
	}
	m := hmac.New(sha256.New, s.PseudonymKey)
	m.Write(id[:])
	p := "u_" + hex.EncodeToString(m.Sum(nil))[:16]
	return &p
}

// period convertit les dates d'un export en instants [since, until) et en dates SQL.
func (s *Service) period(p Params) (since, until time.Time, from, to pgtype.Date, err error) {
	first, err := time.ParseInLocation(time.DateOnly, p.From, s.cfg.Timezone)
	if err != nil {
		return since, until, from, to, fmt.Errorf("%w: from: %v", ErrPermanent, err) //nolint:errorlint // validé à la demande
	}
	last, err := time.ParseInLocation(time.DateOnly, p.To, s.cfg.Timezone)
	if err != nil {
		return since, until, from, to, fmt.Errorf("%w: to: %v", ErrPermanent, err) //nolint:errorlint // idem
	}
	date := func(t time.Time) pgtype.Date {
		return pgtype.Date{Time: time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), Valid: true}
	}
	return first, last.AddDate(0, 0, 1), date(first), date(last), nil
}

func (s *Service) freshness(at time.Time) string {
	switch age := s.now().Sub(at); {
	case age > s.cfg.ExpiredAfter:
		return "expired"
	case age > s.cfg.StaleAfter:
		return "stale"
	default:
		return "fresh"
	}
}

// build lit un jeu de données.
func (s *Service) build(ctx context.Context, dataset string, p Params) (table, error) {
	switch dataset {
	case DatasetStations:
		rows, err := s.Store.ExportStations(ctx, fetchLimit)
		if err != nil {
			return table{}, fmt.Errorf("export: stations: %w", err)
		}
		t := table{columns: []string{
			"id", "status", "name", "brand", "ifu", "rccm", "address", "city", "phone",
			"lat", "lng", "createdAt", "statusChangedAt", "lastStockUpdateAt",
		}}
		for _, r := range rows {
			t.rows = append(t.rows, []any{
				r.ID.String(), string(r.Status), r.Name, r.Brand, r.Ifu, r.Rccm, r.Address,
				r.City, r.Phone, r.Lat, r.Lng, r.CreatedAt, r.StatusChangedAt, r.LastStockUpdateAt,
			})
		}
		return t, nil

	case DatasetStocks:
		rows, err := s.Store.ExportStocks(ctx, fetchLimit)
		if err != nil {
			return table{}, fmt.Errorf("export: stocks: %w", err)
		}
		t := table{columns: []string{
			"stationId", "stationName", "stationStatus", "productCode", "productLabel", "unit",
			"quantity", "updatedAt", "lastConfirmedAt", "freshAt", "freshness",
		}}
		for _, r := range rows {
			t.rows = append(t.rows, []any{
				r.StationID.String(), r.StationName, string(r.StationStatus), r.ProductCode,
				r.ProductLabel, string(r.Unit), r.Quantity, r.UpdatedAt, r.LastConfirmedAt, r.FreshAt, s.freshness(r.FreshAt),
			})
		}
		return t, nil

	case DatasetSearchStats:
		_, _, from, to, err := s.period(p)
		if err != nil {
			return table{}, err
		}
		rows, err := s.Store.CellProductStatsDaily(ctx, dbgen.CellProductStatsDailyParams{FromDay: from, ToDay: to, ProductID: p.ProductID})
		if err != nil {
			return table{}, fmt.Errorf("export: search stats: %w", err)
		}
		t := table{columns: []string{"from", "to", "cell", "cellLat", "cellLng", "productCode", "searches", "emptySearches", "emptyRate"}}
		for _, r := range rows {
			c := h3.FromInt64(r.H3R7)
			if r.Searches < kAnonymity || !h3.Valid(c, h3.ResStats) {
				continue // agrégat sous le seuil d'anonymat : masqué
			}
			lat, lng, err := h3.Center(c)
			if err != nil {
				return table{}, err
			}
			t.rows = append(t.rows, []any{
				p.From, p.To, c.String(), lat, lng, r.ProductCode, r.Searches, r.Empty,
				float64(r.Empty) / float64(r.Searches),
			})
		}
		return t, nil

	case DatasetReports:
		since, until, _, _, err := s.period(p)
		if err != nil {
			return table{}, err
		}
		rows, err := s.Store.ExportReports(ctx, dbgen.ExportReportsParams{Since: since, Until: until, MaxRows: fetchLimit})
		if err != nil {
			return table{}, fmt.Errorf("export: reports: %w", err)
		}
		t := table{columns: []string{
			"id", "createdAt", "stationId", "stationName", "reason", "productCode", "comment",
			"status", "abusive", "resolvedAt", "resolutionNote", "reporter",
		}}
		for _, r := range rows {
			t.rows = append(t.rows, []any{
				r.ID.String(), r.CreatedAt, r.StationID.String(), r.StationName, string(r.Reason),
				r.ProductCode, r.Comment, string(r.Status), r.Abusive, r.ResolvedAt, r.ResolutionNote, s.pseudonym(r.ReporterID),
			})
		}
		return t, nil

	case DatasetAudit:
		since, until, _, _, err := s.period(p)
		if err != nil {
			return table{}, err
		}
		rows, err := s.Store.ExportAuditLogs(ctx, dbgen.ExportAuditLogsParams{Since: since, Until: until, MaxRows: fetchLimit})
		if err != nil {
			return table{}, fmt.Errorf("export: audit: %w", err)
		}
		t := table{columns: []string{"id", "createdAt", "actorId", "actorRole", "action", "entityType", "entityId", "requestId", "metadata"}}
		for _, r := range rows {
			var actor, role *string
			if r.ActorID != nil {
				a := r.ActorID.String()
				actor = &a
			}
			if r.ActorRole != nil {
				ro := string(*r.ActorRole)
				role = &ro
			}
			t.rows = append(t.rows, []any{r.ID, r.CreatedAt, actor, role, r.Action, r.EntityType, r.EntityID, r.RequestID, json.RawMessage(r.Metadata)})
		}
		return t, nil
	}
	return table{}, fmt.Errorf("%w: unknown dataset %q", ErrPermanent, dataset)
}
