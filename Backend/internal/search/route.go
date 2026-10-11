package search

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/platform/osrm"
	"gostation/backend/internal/station"
	"gostation/backend/internal/store"
)

// RouteResult est un itinéraire vers une station.
type RouteResult struct {
	StationID uuid.UUID
	DistanceM int
	DurationS int
	Geometry  string // polyline6
	Steps     []osrm.Step
}

// Route calcule l'itinéraire depuis la position exacte vers une station approuvée
// (GET /api/v1/routes). La position n'est ni stockée ni journalisée. L'itinéraire exige une
// position au Bénin : au-delà, le réseau routier n'est pas couvert par OSRM.
func (s *Service) Route(ctx context.Context, lat, lng float64, stationID uuid.UUID) (RouteResult, error) {
	if err := validCoords(lat, lng); err != nil {
		return RouteResult{}, err
	}
	approximate, err := s.coverage(ctx, lat, lng)
	if err != nil {
		return RouteResult{}, err
	}
	if approximate {
		return RouteResult{}, apperr.New(http.StatusUnprocessableEntity, CodeOutOfCoverage,
			"Turn-by-turn routing is only available from a position in Benin.")
	}
	st, err := s.store.GetPublicStation(ctx, stationID)
	if err != nil {
		return RouteResult{}, fmt.Errorf("search: load station: %w", store.Translate(err))
	}
	if st.Lat == nil || st.Lng == nil {
		return RouteResult{}, apperr.NotFound("This station has no location yet.")
	}
	r, err := s.router.Route(ctx, osrm.Point{Lat: lat, Lng: lng}, osrm.Point{Lat: *st.Lat, Lng: *st.Lng})
	switch {
	case errors.Is(err, osrm.ErrNoRoute):
		return RouteResult{}, apperr.New(http.StatusUnprocessableEntity, CodeNoRoute, "No road route to this station.")
	case err != nil:
		s.log.WarnContext(ctx, "search: route unavailable", slog.Any("err", err))
		return RouteResult{}, apperr.New(http.StatusServiceUnavailable, CodeRoutingDown, "Routing is temporarily unavailable.").Wrap(err)
	}
	return RouteResult{
		StationID: stationID, DistanceM: int(r.DistanceM + 0.5), DurationS: int(r.DurationS + 0.5),
		Geometry: r.Geometry, Steps: r.Steps,
	}, nil
}

// PublicStock est le stock public d'un produit vendu.
type PublicStock struct {
	ProductID int16
	Code      string
	Label     string
	Unit      string
	SizeKg    *float64
	Quantity  *int32 // nil si le stock est expiré (> 24 h) : quantité inconnue
	FreshAt   time.Time
	Freshness string
}

// PublicStation est la fiche publique d'une station approuvée.
type PublicStation struct {
	ID          uuid.UUID
	Name        string
	Brand       *string
	Address     string
	City        *string
	Lat, Lng    *float64
	Schedule    station.Schedule
	Closures    []string // fermetures exceptionnelles à venir (dates locales AAAA-MM-JJ)
	IsOpenNow   bool
	NextOpening *time.Time
	Stocks      []PublicStock
}

// PublicStation renvoie la fiche publique (GET /api/v1/stations/{id}) : 404 si la station n'est pas
// approuvée. Les stocks expirés n'affichent pas de quantité.
func (s *Service) PublicStation(ctx context.Context, id uuid.UUID) (PublicStation, error) {
	st, err := s.store.GetPublicStation(ctx, id)
	if err != nil {
		return PublicStation{}, fmt.Errorf("search: load station: %w", store.Translate(err))
	}
	schedules, err := s.Schedules(ctx, []uuid.UUID{id})
	if err != nil {
		return PublicStation{}, err
	}
	stocks, err := s.store.ListPublicStocks(ctx, id)
	if err != nil {
		return PublicStation{}, fmt.Errorf("search: load stocks: %w", err)
	}
	now := s.now()
	sched := schedules[id]
	out := PublicStation{
		ID: st.ID, Name: st.Name, Brand: st.Brand, Address: st.Address, City: st.City,
		Lat: st.Lat, Lng: st.Lng, Schedule: sched, IsOpenNow: sched.IsOpen(now),
	}
	if next, ok := sched.NextOpening(now); ok {
		n := next.UTC()
		out.NextOpening = &n
	}
	today := now.In(s.cfg.Timezone).Format(time.DateOnly)
	out.Closures = []string{}
	for d := range sched.Closures {
		if d >= today {
			out.Closures = append(out.Closures, d)
		}
	}
	slices.Sort(out.Closures)
	for _, p := range stocks {
		age := now.Sub(p.FreshAt)
		ps := PublicStock{
			ProductID: p.ID, Code: p.Code, Label: p.LabelFr, Unit: string(p.Unit), SizeKg: p.SizeKg,
			FreshAt: p.FreshAt, Freshness: station.FreshnessFresh,
		}
		switch {
		case age > s.cfg.ExpiredAfter:
			ps.Freshness = station.FreshnessExpired
		case age > s.cfg.StaleAfter:
			ps.Freshness = station.FreshnessStale
		}
		if ps.Freshness != station.FreshnessExpired {
			q := p.Quantity
			ps.Quantity = &q
		}
		out.Stocks = append(out.Stocks, ps)
	}
	return out, nil
}
