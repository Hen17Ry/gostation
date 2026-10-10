// Package search implémente la recherche géographique (ARCHITECTURE §4) et l'itinéraire.
//
// Deux étages :
//   - candidats : ensemble des stations candidates pour (cellule H3 res 8, produit), calculé depuis
//     le centre de la cellule avec une marge égale au rayon de la cellule, et mis en cache 60 s.
//     La clé ne contient que la cellule : jamais la position exacte ;
//   - classement : à chaque requête, depuis la position exacte (distance à vol d'oiseau, puis OSRM
//     /table sur les 10 meilleurs). Ce calcul n'est jamais mis en cache ni journalisé.
package search

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	goredis "github.com/redis/go-redis/v9"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/platform/h3"
	"gostation/backend/internal/platform/osrm"
	"gostation/backend/internal/searchcache"
	"gostation/backend/internal/station"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Codes d'erreur stables (docs/ARCHITECTURE.md §5).
const (
	CodeOutOfCoverage = "search.out_of_coverage"
	CodeNoRoute       = "routing.no_route"
	CodeRoutingDown   = "routing.unavailable"
)

// Stratégies de recherche.
const (
	StrategyRadius   = "radius"   // stations ouvertes trouvées dans 50 km
	StrategyFallback = "fallback" // aucune ouverte à 50 km : ouvertes au-delà + fermées (D19)
	StrategyNone     = "none"     // aucune station du pays n'a ce produit en stock frais
)

// Radii est la suite des rayons progressifs (mètres).
var Radii = []int{500, 1000, 2000, 5000, 10000, 25000, 50000}

const (
	maxResults = 10
	// Estimation des trajets quand le routage est approximatif (D20, D21) : détour de 30 %, 40 km/h.
	roadFactor     = 1.3
	estimatedSpeed = 40.0 / 3.6 // m/s
	// shortageRadius : rayon du signal de pénurie des stats (D23).
	shortageRadius = 5000
)

// Config regroupe les réglages.
type Config struct {
	Timezone      *time.Location
	CacheTTL      time.Duration
	MinResults    int
	MaxCandidates int
	StaleAfter    time.Duration
	ExpiredAfter  time.Duration
}

// Router calcule trajets et itinéraires (*osrm.Client).
type Router interface {
	Table(ctx context.Context, from osrm.Point, dests []osrm.Point) ([]*osrm.Leg, error)
	Route(ctx context.Context, from, to osrm.Point) (osrm.Route, error)
}

// Generations lit les générations du cache (*searchcache.Invalidator).
type Generations interface {
	Current(ctx context.Context, productID int16) (searchcache.Generations, error)
}

// StatsRecorder compte les recherches de façon anonyme (*searchstats.Recorder).
type StatsRecorder interface {
	Record(ctx context.Context, cellR7 int64, productID int16, emptyWithin5km bool) error
}

// Service est le moteur de recherche.
type Service struct {
	store  *store.Store
	rdb    goredis.UniversalClient
	gens   Generations
	router Router
	stats  StatsRecorder
	cfg    Config
	log    *slog.Logger
	now    func() time.Time
}

// New construit le service.
func New(cfg Config, st *store.Store, rdb goredis.UniversalClient, gens Generations, router Router, stats StatsRecorder, log *slog.Logger) *Service {
	return &Service{store: st, rdb: rdb, gens: gens, router: router, stats: stats, cfg: cfg, log: log, now: time.Now}
}

// Query est une recherche.
type Query struct {
	Lat, Lng  float64
	ProductID int16
}

// Product résume le produit recherché.
type Product struct {
	ID    int16
	Code  string
	Label string
	Unit  string
}

// Item est une station du résultat.
type Item struct {
	ID             uuid.UUID
	Name           string
	Brand          *string
	Lat, Lng       float64
	DistanceM      int  // vol d'oiseau depuis la position exacte
	RouteDistanceM *int // distance routière (nil si approximatif ou non joignable)
	DurationS      *int // trajet (estimé si approximatif ; nil si non joignable)
	Quantity       int32
	FreshAt        time.Time
	UpdatedAgoS    int
	Stale          bool
	IsOpen         bool
	NextOpening    *time.Time
	ServedAt       *time.Time // heure à laquelle on peut être servi (D19)
}

// Timing mesure les étapes (en-tête Server-Timing).
type Timing struct {
	Total, DB, OSRM time.Duration
	CacheHit        bool
}

// Result est la réponse d'une recherche.
type Result struct {
	Product            Product
	Strategy           string
	RadiusM            *int
	RoutingApproximate bool
	Items              []Item
	GeneratedAt        time.Time
	Timing             Timing
}

// candidate est une station candidate, telle que mise en cache (sans position de l'utilisateur).
type candidate struct {
	ID          uuid.UUID  `json:"id"`
	Name        string     `json:"n"`
	Brand       *string    `json:"b,omitempty"`
	Lat         float64    `json:"la"`
	Lng         float64    `json:"lo"`
	Quantity    int32      `json:"q"`
	FreshAt     time.Time  `json:"f"`
	IsOpen      bool       `json:"o"`
	NextOpening *time.Time `json:"no,omitempty"`
}

type candidateSet struct {
	Strategy   string      `json:"s"`
	RadiusM    *int        `json:"r,omitempty"`
	Candidates []candidate `json:"c"`
}

func validCoords(lat, lng float64) error {
	var fields []apperr.FieldError
	if math.IsNaN(lat) || lat < -90 || lat > 90 {
		fields = append(fields, apperr.FieldError{Field: "lat", Code: "out_of_range", Message: "must be between -90 and 90"})
	}
	if math.IsNaN(lng) || lng < -180 || lng > 180 {
		fields = append(fields, apperr.FieldError{Field: "lng", Code: "out_of_range", Message: "must be between -180 and 180"})
	}
	if len(fields) > 0 {
		return apperr.Validation(fields...)
	}
	return nil
}

// coverage renvoie approximate (hors du Bénin, ≤ 30 km) ou une erreur 422 au-delà (D20).
func (s *Service) coverage(ctx context.Context, lat, lng float64) (bool, error) {
	c, err := s.store.CheckCoverage(ctx, dbgen.CheckCoverageParams{Lat: lat, Lng: lng})
	if err != nil {
		return false, fmt.Errorf("search: coverage: %w", err)
	}
	if !c.Inside && !c.Near {
		return false, apperr.New(http.StatusUnprocessableEntity, CodeOutOfCoverage,
			"GoStation covers Benin and up to 30 km beyond its borders.")
	}
	return !c.Inside, nil
}

func (s *Service) product(ctx context.Context, id int16) (Product, error) {
	rows, err := s.store.ListActiveProducts(ctx)
	if err != nil {
		return Product{}, fmt.Errorf("search: catalog: %w", err)
	}
	for _, p := range rows {
		if p.ID == id {
			return Product{ID: p.ID, Code: p.Code, Label: p.LabelFr, Unit: string(p.Unit)}, nil
		}
	}
	return Product{}, apperr.Validation(apperr.FieldError{Field: "product_id", Code: "unknown_product", Message: "is not an active product"})
}

// Search exécute une recherche (GET /api/v1/search).
func (s *Service) Search(ctx context.Context, q Query) (Result, error) {
	start := s.now()
	var t Timing
	if err := validCoords(q.Lat, q.Lng); err != nil {
		return Result{}, err
	}
	dbStart := s.now()
	product, err := s.product(ctx, q.ProductID)
	if err != nil {
		return Result{}, err
	}
	approximate, err := s.coverage(ctx, q.Lat, q.Lng)
	if err != nil {
		return Result{}, err
	}
	cell, err := h3.CellAt(q.Lat, q.Lng, h3.ResSearchCache)
	if err != nil {
		return Result{}, apperr.Validation(apperr.FieldError{Field: "lat", Code: "invalid", Message: "invalid coordinates"})
	}
	set, hit, err := s.candidates(ctx, cell, q.ProductID)
	if err != nil {
		return Result{}, err
	}
	t.CacheHit = hit
	t.DB = s.now().Sub(dbStart)

	items, approximate, osrmTime := s.rank(ctx, q, set, approximate)
	t.OSRM = osrmTime
	s.record(ctx, q, items)

	res := Result{
		Product: product, Strategy: set.Strategy, RadiusM: set.RadiusM, RoutingApproximate: approximate,
		Items: items, GeneratedAt: s.now().UTC(),
	}
	t.Total = s.now().Sub(start)
	res.Timing = t
	return res, nil
}

// candidates lit l'ensemble des candidats en cache, ou le calcule et le met en cache.
func (s *Service) candidates(ctx context.Context, cell h3.Cell, productID int16) (candidateSet, bool, error) {
	gens, err := s.gens.Current(ctx, productID)
	if err != nil {
		s.log.WarnContext(ctx, "search: cache generations unavailable", slog.Any("err", err))
		set, err := s.compute(ctx, cell, productID)
		return set, false, err
	}
	key := searchcache.Key(productID, gens, cell.String())
	if raw, err := s.rdb.Get(ctx, key).Bytes(); err == nil {
		var set candidateSet
		if json.Unmarshal(raw, &set) == nil {
			return set, true, nil
		}
	} else if !errors.Is(err, goredis.Nil) {
		s.log.WarnContext(ctx, "search: cache read failed", slog.Any("err", err))
	}
	set, err := s.compute(ctx, cell, productID)
	if err != nil {
		return candidateSet{}, false, err
	}
	if raw, err := json.Marshal(set); err == nil {
		if err := s.rdb.Set(ctx, key, raw, s.cfg.CacheTTL).Err(); err != nil {
			s.log.WarnContext(ctx, "search: cache write failed", slog.Any("err", err))
		}
	}
	return set, false, nil
}

// localClock renvoie les paramètres « ouverte maintenant » de la requête SQL.
type localClock struct {
	date, prevDate     pgtype.Date
	isodow, prevISODow int16
	clock              pgtype.Time
}

func (s *Service) clock() localClock {
	now := s.now().In(s.cfg.Timezone)
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	iso := func(t time.Time) int16 {
		if wd := t.Weekday(); wd != time.Sunday {
			return int16(wd) //nolint:gosec // 1 à 6
		}
		return 7
	}
	minutes := int64(now.Hour()*60 + now.Minute())
	return localClock{
		date:       pgtype.Date{Time: day, Valid: true},
		prevDate:   pgtype.Date{Time: day.AddDate(0, 0, -1), Valid: true},
		isodow:     iso(now),
		prevISODow: iso(now.AddDate(0, 0, -1)),
		clock:      pgtype.Time{Microseconds: minutes * int64(time.Minute/time.Microsecond), Valid: true},
	}
}

func fromRow(id uuid.UUID, name string, brand *string, lat, lng *float64, qty int32, fresh time.Time) candidate {
	c := candidate{ID: id, Name: name, Brand: brand, Quantity: qty, FreshAt: fresh}
	if lat != nil && lng != nil {
		c.Lat, c.Lng = *lat, *lng
	}
	return c
}

// compute calcule l'ensemble des candidats depuis le centre de la cellule (rayon + marge).
func (s *Service) compute(ctx context.Context, cell h3.Cell, productID int16) (candidateSet, error) {
	centerLat, centerLng, err := h3.Center(cell)
	if err != nil {
		return candidateSet{}, err
	}
	margin, err := h3.Circumradius(cell)
	if err != nil {
		return candidateSet{}, err
	}
	lc := s.clock()
	freshSince := s.now().Add(-s.cfg.ExpiredAfter)
	limit := int32(s.cfg.MaxCandidates) //nolint:gosec // borné par la config

	for _, r := range Radii {
		rows, err := s.store.ListOpenCandidatesWithin(ctx, dbgen.ListOpenCandidatesWithinParams{
			ProductID: productID, FreshSince: freshSince, Lat: centerLat, Lng: centerLng, RadiusM: float64(r) + margin,
			LocalDate: lc.date, PrevDate: lc.prevDate, Isodow: lc.isodow, PrevIsodow: lc.prevISODow, LocalTime: lc.clock,
			MaxCandidates: limit,
		})
		if err != nil {
			return candidateSet{}, fmt.Errorf("search: radius %d: %w", r, err)
		}
		if len(rows) >= s.cfg.MinResults || (r == Radii[len(Radii)-1] && len(rows) > 0) {
			set := candidateSet{Strategy: StrategyRadius, RadiusM: &r}
			for _, row := range rows {
				c := fromRow(row.ID, row.Name, row.Brand, row.Lat, row.Lng, row.Quantity, row.FreshAt)
				c.IsOpen = true
				set.Candidates = append(set.Candidates, c)
			}
			return set, nil
		}
	}

	// Repli (D19) : ouvertes au-delà de 50 km (KNN illimité) et fermées, triées plus tard par
	// heure à laquelle on peut être servi.
	open, err := s.store.ListOpenCandidatesKNN(ctx, dbgen.ListOpenCandidatesKNNParams{
		ProductID: productID, FreshSince: freshSince, Lat: centerLat, Lng: centerLng,
		LocalDate: lc.date, PrevDate: lc.prevDate, Isodow: lc.isodow, PrevIsodow: lc.prevISODow, LocalTime: lc.clock,
		MaxCandidates: maxResults,
	})
	if err != nil {
		return candidateSet{}, fmt.Errorf("search: knn open: %w", err)
	}
	stocked, err := s.store.ListStockedCandidatesKNN(ctx, dbgen.ListStockedCandidatesKNNParams{
		ProductID: productID, FreshSince: freshSince, Lat: centerLat, Lng: centerLng, MaxCandidates: limit,
	})
	if err != nil {
		return candidateSet{}, fmt.Errorf("search: knn stocked: %w", err)
	}
	seen := map[uuid.UUID]bool{}
	var all []candidate
	for _, row := range open {
		c := fromRow(row.ID, row.Name, row.Brand, row.Lat, row.Lng, row.Quantity, row.FreshAt)
		c.IsOpen = true
		seen[c.ID] = true
		all = append(all, c)
	}
	var closedIDs []uuid.UUID
	for _, row := range stocked {
		if seen[row.ID] {
			continue
		}
		all = append(all, fromRow(row.ID, row.Name, row.Brand, row.Lat, row.Lng, row.Quantity, row.FreshAt))
		closedIDs = append(closedIDs, row.ID)
	}
	if len(all) == 0 {
		return candidateSet{Strategy: StrategyNone, Candidates: []candidate{}}, nil
	}
	schedules, err := s.Schedules(ctx, closedIDs)
	if err != nil {
		return candidateSet{}, err
	}
	now := s.now()
	set := candidateSet{Strategy: StrategyFallback}
	for _, c := range all {
		if !c.IsOpen {
			sched := schedules[c.ID]
			if sched.IsOpen(now) {
				continue // ouverte mais au-delà de la liste KNN ouverte : déjà couverte par elle
			}
			if next, ok := sched.NextOpening(now); ok {
				c.NextOpening = &next
			} else {
				continue // fermée sans réouverture connue (fermetures sur toute l'année)
			}
		}
		set.Candidates = append(set.Candidates, c)
	}
	if len(set.Candidates) == 0 {
		set.Strategy = StrategyNone
		set.Candidates = []candidate{}
	}
	return set, nil
}

// Schedules charge les emplois du temps (horaires + fermetures à venir) de plusieurs stations.
func (s *Service) Schedules(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]station.Schedule, error) {
	out := make(map[uuid.UUID]station.Schedule, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	hours, err := s.store.ListHoursForStations(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("search: hours: %w", err)
	}
	lc := s.clock()
	closures, err := s.store.ListClosuresForStations(ctx, dbgen.ListClosuresForStationsParams{StationIds: ids, FromDate: lc.prevDate})
	if err != nil {
		return nil, fmt.Errorf("search: closures: %w", err)
	}
	for _, id := range ids {
		out[id] = station.Schedule{Loc: s.cfg.Timezone, Closures: map[string]bool{}}
	}
	perMinute := int64(time.Minute / time.Microsecond)
	for _, h := range hours {
		sc := out[h.StationID]
		sc.Ranges = append(sc.Ranges, station.Range{
			Weekday: int(h.Weekday),
			Opens:   int(h.OpensAt.Microseconds / perMinute), Closes: int(h.ClosesAt.Microseconds / perMinute),
		})
		out[h.StationID] = sc
	}
	for _, c := range closures {
		out[c.StationID].Closures[c.ClosedOn.Time.Format(time.DateOnly)] = true
	}
	return out, nil
}

// rank classe les candidats depuis la position exacte : vol d'oiseau, puis OSRM /table sur les
// 10 meilleurs. Repli sur le vol d'oiseau (durées estimées) si OSRM échoue (D21).
func (s *Service) rank(ctx context.Context, q Query, set candidateSet, approximate bool) ([]Item, bool, time.Duration) {
	now := s.now()
	items := make([]Item, 0, len(set.Candidates))
	for _, c := range set.Candidates {
		if now.Sub(c.FreshAt) > s.cfg.ExpiredAfter {
			continue // stock expiré depuis la mise en cache (TTL 60 s)
		}
		dist := h3.Haversine(q.Lat, q.Lng, c.Lat, c.Lng)
		est := int(math.Round(dist * roadFactor / estimatedSpeed))
		it := Item{
			ID: c.ID, Name: c.Name, Brand: c.Brand, Lat: c.Lat, Lng: c.Lng, DistanceM: int(math.Round(dist)),
			DurationS: &est, Quantity: c.Quantity, FreshAt: c.FreshAt, IsOpen: c.IsOpen, NextOpening: c.NextOpening,
			UpdatedAgoS: int(now.Sub(c.FreshAt).Seconds()), Stale: now.Sub(c.FreshAt) > s.cfg.StaleAfter,
		}
		items = append(items, it)
	}
	setServed(items, now)
	if set.Strategy == StrategyFallback {
		sortByServedAt(items)
	} else {
		sort.SliceStable(items, func(a, b int) bool { return items[a].DistanceM < items[b].DistanceM })
	}
	if len(items) > maxResults {
		items = items[:maxResults]
	}
	if len(items) == 0 || approximate {
		return items, approximate, 0
	}

	start := s.now()
	dests := make([]osrm.Point, len(items))
	for i, it := range items {
		dests[i] = osrm.Point{Lat: it.Lat, Lng: it.Lng}
	}
	legs, err := s.router.Table(ctx, osrm.Point{Lat: q.Lat, Lng: q.Lng}, dests)
	osrmTime := s.now().Sub(start)
	if err != nil {
		// L'erreur ne contient aucune coordonnée (expurgée par le client OSRM).
		s.log.WarnContext(ctx, "search: routing unavailable, straight-line ranking", slog.Any("err", err))
		return items, true, osrmTime
	}
	for i, leg := range legs {
		if leg == nil {
			items[i].DurationS, items[i].RouteDistanceM = nil, nil
			continue
		}
		d, rd := int(math.Round(leg.DurationS)), int(math.Round(leg.DistanceM))
		items[i].DurationS, items[i].RouteDistanceM = &d, &rd
	}
	setServed(items, now)
	if set.Strategy == StrategyFallback {
		sortByServedAt(items)
	} else {
		sort.SliceStable(items, func(a, b int) bool { return lessDuration(items[a], items[b]) })
	}
	return items, false, osrmTime
}

// setServed calcule l'heure à laquelle on peut être servi : max(maintenant + trajet, ouverture).
func setServed(items []Item, now time.Time) {
	for i := range items {
		if items[i].DurationS == nil {
			items[i].ServedAt = nil
			continue
		}
		at := now.Add(time.Duration(*items[i].DurationS) * time.Second)
		if !items[i].IsOpen && items[i].NextOpening != nil && items[i].NextOpening.After(at) {
			at = *items[i].NextOpening
		}
		served := at.UTC()
		items[i].ServedAt = &served
	}
}

// lessDuration : joignables d'abord par trajet croissant, non joignables ensuite par distance.
func lessDuration(a, b Item) bool {
	switch {
	case a.DurationS == nil && b.DurationS == nil:
		return a.DistanceM < b.DistanceM
	case a.DurationS == nil:
		return false
	case b.DurationS == nil:
		return true
	default:
		return *a.DurationS < *b.DurationS
	}
}

// sortByServedAt trie par heure à laquelle on peut être servi, puis par trajet (D19).
func sortByServedAt(items []Item) {
	sort.SliceStable(items, func(a, b int) bool {
		x, y := items[a], items[b]
		switch {
		case x.ServedAt == nil && y.ServedAt == nil:
			return x.DistanceM < y.DistanceM
		case x.ServedAt == nil:
			return false
		case y.ServedAt == nil:
			return true
		case !x.ServedAt.Equal(*y.ServedAt):
			return x.ServedAt.Before(*y.ServedAt)
		default:
			return lessDuration(x, y)
		}
	})
}

// record compte la recherche (cellule res 7, produit, pénurie à 5 km) ; jamais la position.
func (s *Service) record(ctx context.Context, q Query, items []Item) {
	if s.stats == nil {
		return
	}
	cell, err := h3.CellAt(q.Lat, q.Lng, h3.ResStats)
	if err != nil {
		return
	}
	empty := true
	for _, it := range items {
		if it.IsOpen && it.DistanceM <= shortageRadius {
			empty = false
			break
		}
	}
	if err := s.stats.Record(ctx, h3.ToInt64(cell), q.ProductID, empty); err != nil {
		s.log.WarnContext(ctx, "search: stats not recorded", slog.Any("err", err))
	}
}
