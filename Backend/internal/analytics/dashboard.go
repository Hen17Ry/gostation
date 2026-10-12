package analytics

import (
	"context"
	"fmt"
	"time"

	"golang.org/x/sync/errgroup"

	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// ProductSearches est le volume de recherches d'un produit sur la période.
type ProductSearches struct {
	Product ProductInfo
	KPI
}

// Dashboard regroupe les indicateurs du tableau de bord, en un seul appel.
type Dashboard struct {
	Period Period
	// Stations par statut (un dossier pending ne compte qu'une fois l'email du gérant vérifié).
	StationsByStatus map[string]int
	PendingCount     int
	OldestPendingAt  *time.Time
	// Fraîcheur actuelle des stocks des stations approuvées.
	Freshness Freshness
	// Alertes ouvertes par type (dont « gérant inactif »).
	OpenAlerts map[string]int
	// Recherches sur la période, au total et par produit, et part sans station ouverte à 5 km.
	Searches          KPI
	SearchesByProduct []ProductSearches
	EmptyRate         KPI
	// Zones en pénurie (k ≥ K) : nombre et top par recherches sans résultat.
	ShortageZones int
	TopShortages  []Cell
	// Signalements ouverts, et créés sur la période.
	OpenReports    int
	ReportsCreated KPI
	// Inscriptions sur la période.
	UserSignups    KPI
	ManagerSignups KPI
	// Séries des graphiques.
	SearchSeries    []SeriesPoint
	FreshnessSeries []FreshnessPoint
	Products        map[int16]ProductInfo
}

// InactiveManagers renvoie le nombre de stations dont le gérant est signalé inactif.
func (d Dashboard) InactiveManagers() int {
	return d.OpenAlerts[string(dbgen.AdminAlertKindManagerInactive)]
}

// Dashboard calcule tous les indicateurs de la période. Les requêtes, indépendantes et toutes
// servies par des index ou des agrégats, partent en parallèle (4 à la fois).
func (s *Service) Dashboard(ctx context.Context, p Period) (Dashboard, error) {
	d := Dashboard{Period: p, StationsByStatus: map[string]int{}, OpenAlerts: map[string]int{}}
	var order []int16
	var cur, prev map[int16][2]int64
	var cells []Cell
	var reportsCur, reportsPrev int32
	var signups, signupsPrev dbgen.CountRegistrationsRow

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(maxParallelDB)
	g.Go(func() (err error) { d.Products, order, err = s.products(gctx); return err })
	g.Go(func() error {
		rows, err := s.q.CountStationsByStatus(gctx)
		if err != nil {
			return fmt.Errorf("analytics: stations by status: %w", err)
		}
		for _, st := range dbgen.AllStationStatusValues() {
			d.StationsByStatus[string(st)] = 0
		}
		for _, r := range rows {
			d.StationsByStatus[string(r.Status)] = int(r.Count)
		}
		return nil
	})
	g.Go(func() error {
		at, err := s.q.OldestPendingApplication(gctx)
		if store.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("analytics: oldest pending: %w", err)
		}
		d.OldestPendingAt = &at
		return nil
	})
	g.Go(func() (err error) { d.Freshness, _, err = s.freshnessNow(gctx); return err })
	g.Go(func() error {
		rows, err := s.q.CountOpenAdminAlerts(gctx)
		if err != nil {
			return fmt.Errorf("analytics: open alerts: %w", err)
		}
		for _, k := range dbgen.AllAdminAlertKindValues() {
			d.OpenAlerts[string(k)] = 0
		}
		for _, r := range rows {
			d.OpenAlerts[string(r.Kind)] = int(r.Count)
		}
		return nil
	})
	g.Go(func() (err error) { cur, err = s.totals(gctx, p.From, p.To); return err })
	g.Go(func() (err error) { prev, err = s.totals(gctx, p.PrevFrom, p.PrevTo); return err })
	g.Go(func() (err error) { cells, _, err = s.cells(gctx, p, nil); return err })
	g.Go(func() (err error) {
		n, err := s.q.CountOpenReports(gctx)
		d.OpenReports = int(n)
		return err
	})
	g.Go(func() (err error) {
		reportsCur, err = s.q.CountReportsCreated(gctx, dbgen.CountReportsCreatedParams{Since: p.From, Until: p.To})
		return err
	})
	g.Go(func() (err error) {
		reportsPrev, err = s.q.CountReportsCreated(gctx, dbgen.CountReportsCreatedParams{Since: p.PrevFrom, Until: p.PrevTo})
		return err
	})
	g.Go(func() (err error) {
		signups, err = s.q.CountRegistrations(gctx, dbgen.CountRegistrationsParams{Since: p.From, Until: p.To})
		return err
	})
	g.Go(func() (err error) {
		signupsPrev, err = s.q.CountRegistrations(gctx, dbgen.CountRegistrationsParams{Since: p.PrevFrom, Until: p.PrevTo})
		return err
	})
	g.Go(func() (err error) { d.SearchSeries, err = s.series(gctx, p, nil); return err })
	g.Go(func() (err error) { d.FreshnessSeries, err = s.freshnessSeries(gctx, p); return err })
	if err := g.Wait(); err != nil {
		return Dashboard{}, fmt.Errorf("analytics: dashboard: %w", err)
	}

	d.PendingCount = d.StationsByStatus[string(dbgen.StationStatusPending)]
	cs, ce := sum(cur, nil)
	ps, pe := sum(prev, nil)
	d.Searches = KPI{Value: float64(cs), Previous: float64(ps)}
	d.EmptyRate = KPI{Value: rate(ce, cs), Previous: rate(pe, ps)}
	for _, id := range order {
		c, p := cur[id], prev[id]
		if !d.Products[id].Active && c[0] == 0 && p[0] == 0 {
			continue // produit désactivé sans recherche : rien à montrer
		}
		d.SearchesByProduct = append(d.SearchesByProduct, ProductSearches{
			Product: d.Products[id], KPI: KPI{Value: float64(c[0]), Previous: float64(p[0])},
		})
	}
	for _, c := range cells {
		if c.Shortage {
			d.ShortageZones++
		}
	}
	d.TopShortages = topShortages(cells, TopZones)
	d.ReportsCreated = KPI{Value: float64(reportsCur), Previous: float64(reportsPrev)}
	d.UserSignups = KPI{Value: float64(signups.Users), Previous: float64(signupsPrev.Users)}
	d.ManagerSignups = KPI{Value: float64(signups.Managers), Previous: float64(signupsPrev.Managers)}
	return d, nil
}

// Counters sont les compteurs des badges de la barre latérale admin.
type Counters struct {
	PendingStations int
	OpenReports     int
	OpenAlerts      int
	LocationReviews int
}

// Counters compte ce qui attend l'admin : dossiers, signalements, alertes, épingles à vérifier.
func (s *Service) Counters(ctx context.Context) (Counters, error) {
	r, err := s.store.AdminCounters(ctx)
	if err != nil {
		return Counters{}, fmt.Errorf("analytics: counters: %w", err)
	}
	return Counters{
		PendingStations: int(r.PendingStations), OpenReports: int(r.OpenReports), OpenAlerts: int(r.OpenAlerts),
		LocationReviews: int(r.LocationReviews),
	}, nil
}
