package station

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Closure est une fermeture exceptionnelle.
type Closure struct {
	ID        uuid.UUID
	Date      time.Time // date civile locale (minuit, fuseau de l'application)
	Reason    *string
	CreatedAt time.Time
}

// HoursView est la vue gérant des horaires.
type HoursView struct {
	Version     int32
	Ranges      []Range
	Closures    []Closure
	IsOpenNow   bool
	NextOpening *time.Time
}

func minutesToTime(m int) pgtype.Time {
	return pgtype.Time{Microseconds: int64(m) * int64(time.Minute/time.Microsecond), Valid: true}
}

func timeToMinutes(t pgtype.Time) int {
	return int(t.Microseconds / int64(time.Minute/time.Microsecond))
}

func (s *Service) today() time.Time {
	local := s.now().In(s.cfg.Timezone)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, s.cfg.Timezone)
}

// LoadSchedule charge l'emploi du temps d'une station (plages et fermetures à venir).
func (s *Service) LoadSchedule(ctx context.Context, q *dbgen.Queries, stationID uuid.UUID) (Schedule, []Closure, error) {
	rows, err := q.ListOpeningHours(ctx, stationID)
	if err != nil {
		return Schedule{}, nil, fmt.Errorf("station: list opening hours: %w", err)
	}
	sched := Schedule{Loc: s.cfg.Timezone, Closures: map[string]bool{}}
	for _, r := range rows {
		sched.Ranges = append(sched.Ranges, Range{Weekday: int(r.Weekday), Opens: timeToMinutes(r.OpensAt), Closes: timeToMinutes(r.ClosesAt)})
	}
	// La veille compte : sa fermeture annule la fin d'une plage de nuit commencée ce jour-là.
	from := s.today().AddDate(0, 0, -1)
	crows, err := q.ListClosures(ctx, dbgen.ListClosuresParams{StationID: stationID, FromDate: pgtype.Date{Time: from, Valid: true}})
	if err != nil {
		return Schedule{}, nil, fmt.Errorf("station: list closures: %w", err)
	}
	today := s.today()
	var closures []Closure
	for _, c := range crows {
		d := time.Date(c.ClosedOn.Time.Year(), c.ClosedOn.Time.Month(), c.ClosedOn.Time.Day(), 0, 0, 0, 0, s.cfg.Timezone)
		sched.Closures[dateKey(d)] = true
		if !d.Before(today) {
			closures = append(closures, Closure{ID: c.ID, Date: d, Reason: c.Reason, CreatedAt: c.CreatedAt})
		}
	}
	return sched, closures, nil
}

func (s *Service) hoursView(ctx context.Context, q *dbgen.Queries, st dbgen.GetStationByManagerRow) (HoursView, error) {
	return s.hoursFor(ctx, q, st.ID, st.Version)
}

// hoursFor calcule la vue des horaires d'une station (gérant et détail admin).
func (s *Service) hoursFor(ctx context.Context, q *dbgen.Queries, stationID uuid.UUID, version int32) (HoursView, error) {
	sched, closures, err := s.LoadSchedule(ctx, q, stationID)
	if err != nil {
		return HoursView{}, err
	}
	v := HoursView{Version: version, Ranges: sched.Ranges, Closures: closures, IsOpenNow: sched.IsOpen(s.now())}
	if next, ok := sched.NextOpening(s.now()); ok {
		v.NextOpening = &next
	}
	return v, nil
}

// Hours renvoie les horaires de la station du gérant.
func (s *Service) Hours(ctx context.Context, managerID uuid.UUID) (HoursView, error) {
	st, err := s.managerStation(ctx, s.Store.Queries, managerID)
	if err != nil {
		return HoursView{}, err
	}
	return s.hoursView(ctx, s.Store.Queries, st)
}

// ReplaceHours remplace la semaine complète (D12). Un jour absent est un jour fermé.
func (s *Service) ReplaceHours(ctx context.Context, a Actor, expected int32, in HoursInput) (HoursView, error) {
	ranges, err := ParseHours(in)
	if err != nil {
		return HoursView{}, err
	}
	var stationID uuid.UUID
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		st, err := s.managerStation(ctx, q, a.UserID)
		if err != nil {
			return err
		}
		stationID = st.ID
		if _, err := bump(ctx, q, st.ID, expected); err != nil {
			return err
		}
		if err := q.DeleteOpeningHours(ctx, st.ID); err != nil {
			return fmt.Errorf("station: delete opening hours: %w", err)
		}
		rows := make([]dbgen.InsertOpeningHoursParams, len(ranges))
		for i, r := range ranges {
			rows[i] = dbgen.InsertOpeningHoursParams{StationID: st.ID, Weekday: int16(r.Weekday), //nolint:gosec // 1..7
				OpensAt: minutesToTime(r.Opens), ClosesAt: minutesToTime(r.Closes)}
		}
		if _, err := q.InsertOpeningHours(ctx, rows); err != nil {
			return fmt.Errorf("station: insert opening hours: %w", err)
		}
		return nil
	})
	if err != nil {
		return HoursView{}, err
	}
	s.audit(ctx, a, audit.ActionHoursUpdated, stationID, map[string]any{"ranges": len(ranges), "allWeek24h": in.AllWeek24h})
	s.invalidate(ctx, true)
	return s.Hours(ctx, a.UserID)
}

// AddClosure ajoute une fermeture exceptionnelle (journée entière, motif facultatif).
func (s *Service) AddClosure(ctx context.Context, a Actor, expected int32, date string, reason *string) (Closure, int32, error) {
	d, err := ParseClosureDate(date, s.now(), s.cfg.Timezone)
	if err != nil {
		return Closure{}, 0, err
	}
	if reason != nil {
		r := strings.TrimSpace(*reason)
		if utf8.RuneCountInString(r) > 200 {
			return Closure{}, 0, apperr.Validation(apperr.FieldError{Field: "reason", Code: "too_long", Message: "must be at most 200 characters"})
		}
		reason = nil
		if r != "" {
			reason = &r
		}
	}
	var out Closure
	var version int32
	var stationID uuid.UUID
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		st, err := s.managerStation(ctx, q, a.UserID)
		if err != nil {
			return err
		}
		stationID = st.ID
		if version, err = bump(ctx, q, st.ID, expected); err != nil {
			return err
		}
		row, err := q.CreateClosure(ctx, dbgen.CreateClosureParams{
			StationID: st.ID, ClosedOn: pgtype.Date{Time: d, Valid: true}, Reason: reason, CreatedBy: &a.UserID,
		})
		if store.ConstraintName(err) == "uq_station_closures_day" {
			return apperr.New(http.StatusConflict, CodeClosureExists, "A closure already exists on this date.").Wrap(err)
		}
		if err != nil {
			return fmt.Errorf("station: create closure: %w", err)
		}
		out = Closure{ID: row.ID, Date: d, Reason: row.Reason, CreatedAt: row.CreatedAt}
		return nil
	})
	if err != nil {
		return Closure{}, 0, err
	}
	s.audit(ctx, a, audit.ActionClosureAdded, stationID, map[string]any{"date": d.Format(time.DateOnly)})
	s.invalidate(ctx, true)
	return out, version, nil
}

// DeleteClosure supprime une fermeture de la station du gérant (404 sinon).
func (s *Service) DeleteClosure(ctx context.Context, a Actor, expected int32, closureID uuid.UUID) (int32, error) {
	var version int32
	var stationID uuid.UUID
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		st, err := s.managerStation(ctx, q, a.UserID)
		if err != nil {
			return err
		}
		stationID = st.ID
		if version, err = bump(ctx, q, st.ID, expected); err != nil {
			return err
		}
		n, err := q.DeleteClosure(ctx, dbgen.DeleteClosureParams{ID: closureID, StationID: st.ID})
		if err != nil {
			return fmt.Errorf("station: delete closure: %w", err)
		}
		if n == 0 {
			return apperr.NotFound("Closure not found.")
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	s.audit(ctx, a, audit.ActionClosureRemoved, stationID, map[string]any{"closureId": closureID.String()})
	s.invalidate(ctx, true)
	return version, nil
}
