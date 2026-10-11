// Package analytics sert le tableau de bord et les stats de l'admin (étape 7) : indicateurs avec
// évolution sur la période précédente, séries temporelles, carte des pénuries, et le relevé horaire
// de la fraîcheur des stocks (tâche stats:freshness du worker).
//
// Anonymat : les stats de recherche sont des compteurs par cellule H3 res 7 et par heure (D23).
// Une cellule n'est montrée que si l'agrégat affiché (cellule, produit ou tous produits, période)
// compte au moins K recherches ; en dessous, elle est masquée (seul leur nombre est donné). Les
// agrégats tous lieux confondus (totaux, séries) ne descendent jamais à la cellule.
//
// Zone en pénurie : cellule où au moins 50 % des recherches n'ont trouvé aucune station ouverte à
// moins de 5 km.
package analytics

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/sync/errgroup"

	"gostation/backend/internal/platform/h3"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Règles d'anonymat et de pénurie.
const (
	K             = 5   // recherches minimum de l'agrégat affiché
	ShortageRate  = 0.5 // part de recherches sans station ouverte à 5 km
	TopZones      = 10  // zones en pénurie du tableau de bord
	maxParallelDB = 4   // requêtes simultanées du tableau de bord
)

// Config regroupe les réglages.
type Config struct {
	Timezone     *time.Location
	StaleAfter   time.Duration
	ExpiredAfter time.Duration
}

// Service calcule les indicateurs.
type Service struct {
	store *store.Store
	// q exécute les agrégats sans plan mis en cache (store.Unprepared) : chaque requête est
	// planifiée avec ses vraies bornes de dates.
	q   *dbgen.Queries
	cfg Config
	now func() time.Time
}

// New construit le service ; clock remplace l'horloge (tests), nil = time.Now.
func New(cfg Config, st *store.Store, clock func() time.Time) *Service {
	if clock == nil {
		clock = time.Now
	}
	return &Service{store: st, q: st.Unprepared(), cfg: cfg, now: clock}
}

// Period lit la période demandée (voir ParsePeriod).
func (s *Service) Period(key, from, to string) (Period, error) {
	return ParsePeriod(key, from, to, s.now(), s.cfg.Timezone)
}

// KPI est un indicateur sur la période et sur la période précédente.
type KPI struct {
	Value    float64
	Previous float64
}

// Change renvoie l'évolution relative (nil si la période précédente vaut 0).
func (k KPI) Change() *float64 {
	if k.Previous == 0 {
		return nil
	}
	c := (k.Value - k.Previous) / k.Previous
	return &c
}

func rate(empty, searches int64) float64 {
	if searches == 0 {
		return 0
	}
	return float64(empty) / float64(searches)
}

// ProductInfo identifie un produit dans les résultats.
type ProductInfo struct {
	ID     int16
	Code   string
	Label  string
	Active bool
}

func (s *Service) products(ctx context.Context) (map[int16]ProductInfo, []int16, error) {
	rows, err := s.q.ListProductsForAdmin(ctx, dbgen.ListProductsForAdminParams{PageSize: 1000})
	if err != nil {
		return nil, nil, fmt.Errorf("analytics: products: %w", err)
	}
	out := make(map[int16]ProductInfo, len(rows))
	order := make([]int16, 0, len(rows))
	for _, r := range rows {
		out[r.ID] = ProductInfo{ID: r.ID, Code: r.Code, Label: r.LabelFr, Active: r.IsActive}
		order = append(order, r.ID)
	}
	return out, order, nil
}

// pgDate convertit un minuit local en date SQL (année, mois, jour locaux).
func pgDate(t time.Time) pgtype.Date {
	return pgtype.Date{Time: time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), Valid: true}
}

// ── Cellules ────────────────────────────────────────────────────────────────

// Cell est l'agrégat d'une cellule H3 res 7 sur la période (au moins K recherches).
type Cell struct {
	Cell     h3.Cell
	Searches int64
	Empty    int64
	Rate     float64
	Shortage bool
}

// cells lit les agrégats par cellule de la période, puis masque ceux de moins de K recherches.
func (s *Service) cells(ctx context.Context, p Period, productID *int16) ([]Cell, int, error) {
	type row struct{ cell, searches, empty int64 }
	var rows []row
	if p.Hourly {
		rs, err := s.q.CellStatsHourly(ctx, dbgen.CellStatsHourlyParams{Since: p.From, Until: p.To, ProductID: productID})
		if err != nil {
			return nil, 0, fmt.Errorf("analytics: cell stats: %w", err)
		}
		for _, r := range rs {
			rows = append(rows, row{r.H3R7, r.Searches, r.Empty})
		}
	} else {
		rs, err := s.q.CellStatsDaily(ctx, dbgen.CellStatsDailyParams{FromDay: pgDate(p.FirstDay), ToDay: pgDate(p.LastDay), ProductID: productID})
		if err != nil {
			return nil, 0, fmt.Errorf("analytics: cell stats: %w", err)
		}
		for _, r := range rs {
			rows = append(rows, row{r.H3R7, r.Searches, r.Empty})
		}
	}
	out := make([]Cell, 0, len(rows))
	masked := 0
	for _, r := range rows {
		c := h3.FromInt64(r.cell)
		if r.searches < K || !h3.Valid(c, h3.ResStats) {
			masked++
			continue
		}
		rt := rate(r.empty, r.searches)
		out = append(out, Cell{Cell: c, Searches: r.searches, Empty: r.empty, Rate: rt, Shortage: rt >= ShortageRate})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Cell < out[j].Cell })
	return out, masked, nil
}

// Shortages est la carte des pénuries : cellules visibles (k ≥ K) avec leur taux.
type Shortages struct {
	Period      Period
	ProductID   *int16
	Cells       []Cell
	MaskedCells int
}

// ShortageMap renvoie les cellules de la période (toutes, ou seulement celles en pénurie).
func (s *Service) ShortageMap(ctx context.Context, p Period, productID *int16, onlyShortages bool) (Shortages, error) {
	cells, masked, err := s.cells(ctx, p, productID)
	if err != nil {
		return Shortages{}, err
	}
	if onlyShortages {
		cells = slices.DeleteFunc(cells, func(c Cell) bool { return !c.Shortage })
	}
	return Shortages{Period: p, ProductID: productID, Cells: cells, MaskedCells: masked}, nil
}

// topShortages classe les zones en pénurie par recherches sans résultat (demande non servie).
func topShortages(cells []Cell, n int) []Cell {
	var out []Cell
	for _, c := range cells {
		if c.Shortage {
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Empty != out[j].Empty {
			return out[i].Empty > out[j].Empty
		}
		return out[i].Rate > out[j].Rate
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// ── Recherches ──────────────────────────────────────────────────────────────

// SeriesPoint est une tranche d'une série.
type SeriesPoint struct {
	At        time.Time
	Searches  int64
	Empty     int64
	ByProduct map[int16]int64
}

// HourPoint est la répartition par heure de la journée (heure locale).
type HourPoint struct {
	Hour     int
	Searches int64
	Empty    int64
}

// Searches est la vue « recherches » des stats, tous lieux confondus.
type Searches struct {
	Period    Period
	ProductID *int16
	Products  map[int16]ProductInfo
	Total     KPI // recherches
	EmptyRate KPI // part sans station ouverte à 5 km
	Series    []SeriesPoint
	ByHour    []HourPoint
}

func (s *Service) series(ctx context.Context, p Period, productID *int16) ([]SeriesPoint, error) {
	rows, err := s.q.SearchSeries(ctx, dbgen.SearchSeriesParams{
		Unit: p.Granularity, Tz: s.cfg.Timezone.String(), Since: p.From, Until: p.To, ProductID: productID,
	})
	if err != nil {
		return nil, fmt.Errorf("analytics: search series: %w", err)
	}
	byAt := map[int64]*SeriesPoint{}
	buckets := p.buckets(s.cfg.Timezone)
	out := make([]SeriesPoint, len(buckets))
	for i, b := range buckets {
		out[i] = SeriesPoint{At: b, ByProduct: map[int16]int64{}}
		byAt[b.Unix()] = &out[i]
	}
	for _, r := range rows {
		pt := byAt[r.At.Unix()]
		if pt == nil {
			continue
		}
		pt.Searches += r.Searches
		pt.Empty += r.Empty
		pt.ByProduct[r.ProductID] += r.Searches
	}
	return out, nil
}

func (s *Service) totals(ctx context.Context, since, until time.Time) (map[int16][2]int64, error) {
	rows, err := s.q.SearchTotalsByProduct(ctx, dbgen.SearchTotalsByProductParams{Since: since, Until: until})
	if err != nil {
		return nil, fmt.Errorf("analytics: search totals: %w", err)
	}
	out := make(map[int16][2]int64, len(rows))
	for _, r := range rows {
		out[r.ProductID] = [2]int64{r.Searches, r.Empty}
	}
	return out, nil
}

func sum(m map[int16][2]int64, productID *int16) (searches, empty int64) {
	for id, v := range m {
		if productID == nil || *productID == id {
			searches += v[0]
			empty += v[1]
		}
	}
	return searches, empty
}

// SearchStats renvoie totaux et évolution, série temporelle et répartition par heure de la journée.
func (s *Service) SearchStats(ctx context.Context, p Period, productID *int16) (Searches, error) {
	out := Searches{Period: p, ProductID: productID}
	var cur, prev map[int16][2]int64
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(maxParallelDB)
	g.Go(func() (err error) { out.Products, _, err = s.products(gctx); return err })
	g.Go(func() (err error) { cur, err = s.totals(gctx, p.From, p.To); return err })
	g.Go(func() (err error) { prev, err = s.totals(gctx, p.PrevFrom, p.PrevTo); return err })
	g.Go(func() (err error) { out.Series, err = s.series(gctx, p, productID); return err })
	g.Go(func() error {
		rows, err := s.q.SearchesByHourOfDay(gctx, dbgen.SearchesByHourOfDayParams{
			Tz: s.cfg.Timezone.String(), Since: p.From, Until: p.To, ProductID: productID,
		})
		if err != nil {
			return fmt.Errorf("analytics: searches by hour: %w", err)
		}
		out.ByHour = make([]HourPoint, 24)
		for h := range out.ByHour {
			out.ByHour[h].Hour = h
		}
		for _, r := range rows {
			if r.Hour >= 0 && r.Hour < 24 {
				out.ByHour[r.Hour].Searches, out.ByHour[r.Hour].Empty = r.Searches, r.Empty
			}
		}
		return nil
	})
	if err := g.Wait(); err != nil {
		return Searches{}, err
	}
	cs, ce := sum(cur, productID)
	ps, pe := sum(prev, productID)
	out.Total = KPI{Value: float64(cs), Previous: float64(ps)}
	out.EmptyRate = KPI{Value: rate(ce, cs), Previous: rate(pe, ps)}
	return out, nil
}

// ── Fraîcheur ───────────────────────────────────────────────────────────────

// Freshness compte les stocks par fraîcheur.
type Freshness struct {
	Fresh, Stale, Expired int
}

// Total renvoie le nombre de stocks.
func (f Freshness) Total() int { return f.Fresh + f.Stale + f.Expired }

// FreshnessPoint est une tranche de la série de fraîcheur (moyenne des relevés horaires).
type FreshnessPoint struct {
	At time.Time
	Freshness
	Measured bool // au moins un relevé dans la tranche
}

func (s *Service) freshnessNow(ctx context.Context) (Freshness, map[int16]Freshness, error) {
	now := s.now()
	rows, err := s.q.StockFreshnessByProduct(ctx, dbgen.StockFreshnessByProductParams{
		StaleSince: now.Add(-s.cfg.StaleAfter), ExpiredSince: now.Add(-s.cfg.ExpiredAfter),
	})
	if err != nil {
		return Freshness{}, nil, fmt.Errorf("analytics: stock freshness: %w", err)
	}
	var total Freshness
	byProduct := make(map[int16]Freshness, len(rows))
	for _, r := range rows {
		f := Freshness{Fresh: int(r.Fresh), Stale: int(r.Stale), Expired: int(r.Expired)}
		byProduct[r.ProductID] = f
		total.Fresh += f.Fresh
		total.Stale += f.Stale
		total.Expired += f.Expired
	}
	return total, byProduct, nil
}

func (s *Service) freshnessSeries(ctx context.Context, p Period) ([]FreshnessPoint, error) {
	rows, err := s.q.FreshnessSeries(ctx, dbgen.FreshnessSeriesParams{
		Unit: p.Granularity, Tz: s.cfg.Timezone.String(), Since: p.From, Until: p.To,
	})
	if err != nil {
		return nil, fmt.Errorf("analytics: freshness series: %w", err)
	}
	buckets := p.buckets(s.cfg.Timezone)
	out := make([]FreshnessPoint, len(buckets))
	index := map[int64]int{}
	for i, b := range buckets {
		out[i] = FreshnessPoint{At: b}
		index[b.Unix()] = i
	}
	for _, r := range rows {
		if i, ok := index[r.At.Unix()]; ok {
			out[i].Freshness = Freshness{Fresh: int(r.Fresh), Stale: int(r.Stale), Expired: int(r.Expired)}
			out[i].Measured = true
		}
	}
	return out, nil
}

// SnapshotFreshness enregistre le relevé horaire de la fraîcheur des stocks (tâche du worker) ;
// un second passage dans la même heure remplace le premier.
func (s *Service) SnapshotFreshness(ctx context.Context) (int, error) {
	_, byProduct, err := s.freshnessNow(ctx)
	if err != nil {
		return 0, err
	}
	bucket := s.now().UTC().Truncate(time.Hour)
	err = s.store.InTx(ctx, func(q *dbgen.Queries) error {
		for id, f := range byProduct {
			if err := q.UpsertFreshnessSnapshot(ctx, dbgen.UpsertFreshnessSnapshotParams{
				Bucket: bucket, ProductID: id, Fresh: int32(f.Fresh), Stale: int32(f.Stale), Expired: int32(f.Expired), //nolint:gosec // comptages
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("analytics: freshness snapshot: %w", err)
	}
	return len(byProduct), nil
}
