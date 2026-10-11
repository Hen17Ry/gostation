//go:build integration

package app_test

import (
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/platform/h3"
	"gostation/backend/internal/search"
	"gostation/backend/internal/station"
)

// Positions de référence (au Bénin).
var (
	calavi  = [2]float64{6.4485, 2.3557}
	parakou = [2]float64{9.3370, 2.6303}
	bohicon = [2]float64{7.1783, 2.0667}
)

// move déplace une position de dNorth et dEast mètres.
func move(p [2]float64, dNorth, dEast float64) [2]float64 {
	return [2]float64{p[0] + dNorth/111_320, p[1] + dEast/(111_320*math.Cos(p[0]*math.Pi/180))}
}

// cellCenter renvoie le centre de la cellule H3 res 8 de p : les rayons progressifs partent de
// ce centre, ce qui rend les paliers déterministes.
func cellCenter(t *testing.T, p [2]float64) ([2]float64, float64) {
	t.Helper()
	cell, err := h3.CellAt(p[0], p[1], h3.ResSearchCache)
	if err != nil {
		t.Fatal(err)
	}
	lat, lng, err := h3.Center(cell)
	if err != nil {
		t.Fatal(err)
	}
	margin, err := h3.Circumradius(cell)
	if err != nil {
		t.Fatal(err)
	}
	return [2]float64{lat, lng}, margin
}

var productSeq atomic.Int32

// newProduct crée un produit propre au test : ses stations et son cache de recherche sont isolés
// de ceux des autres tests.
func newProduct(t *testing.T) int16 {
	t.Helper()
	n := productSeq.Add(1)
	var id int16
	err := it.pool.QueryRow(t.Context(),
		`INSERT INTO products (code, kind, unit, size_kg, label_fr, sort_order)
		 VALUES ($1, 'lpg', 'cylinder', $2::numeric, $3, 99) RETURNING id`,
		fmt.Sprintf("test_lpg_%d_%s", n, uuid.NewString()[:8]), fmt.Sprintf("%d.%02d", 100+n/100, n%100),
		fmt.Sprintf("Gaz test %d", n)).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// seed décrit une station insérée directement en base.
type seed struct {
	name       string
	at         [2]float64
	status     string        // défaut : approved
	noHours    bool          // aucun horaire
	closedDays int           // fermetures exceptionnelles à partir d'aujourd'hui
	qty        int32         // quantité (défaut 10) ; -1 : produit non vendu
	zero       bool          // vendu mais à 0
	age        time.Duration // âge du stock
}

func seedStation(t *testing.T, product int16, s seed) uuid.UUID {
	t.Helper()
	ctx := t.Context()
	if s.status == "" {
		s.status = "approved"
	}
	switch {
	case s.zero:
		s.qty = 0
	case s.qty == 0:
		s.qty = 10
	}
	if s.name == "" {
		s.name = "Station " + uuid.NewString()[:6]
	}
	var inside bool
	if err := it.pool.QueryRow(ctx, `SELECT ST_Covers(boundary, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography)
		FROM country_boundaries WHERE code = 'BEN'`, s.at[0], s.at[1]).Scan(&inside); err != nil || !inside {
		t.Fatalf("seed %q outside Benin (%v): %v", s.name, s.at, err)
	}
	var id uuid.UUID
	err := it.pool.QueryRow(ctx, `INSERT INTO stations (status, name, brand, ifu, rccm, address, city, phone, location, location_set_at)
		VALUES ($1::station_status, $2, 'Test', $3, 'RB/COT/26 B 0001', 'Carrefour test', 'Test', '+2290197000000',
		        ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, now())
		RETURNING id`, s.status, s.name, randomIFU(), s.at[0], s.at[1]).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	if !s.noHours {
		if _, err := it.pool.Exec(ctx, `INSERT INTO station_opening_hours (station_id, weekday, opens_at, closes_at)
			SELECT $1, d, '00:00', '24:00' FROM generate_series(1, 7) AS d`, id); err != nil {
			t.Fatal(err)
		}
	}
	today := time.Now().In(it.cfg.Timezone)
	for d := range s.closedDays {
		day := today.AddDate(0, 0, d).Format(time.DateOnly)
		if _, err := it.pool.Exec(ctx, `INSERT INTO station_closures (station_id, closed_on) VALUES ($1, $2::date)`, id, day); err != nil {
			t.Fatal(err)
		}
	}
	if s.qty >= 0 {
		if _, err := it.pool.Exec(ctx, `INSERT INTO station_stocks (station_id, product_id, quantity, updated_at, last_confirmed_at)
			VALUES ($1, $2, $3, now() - $4::interval, now() - $4::interval)`, id, product, s.qty, s.age.String()); err != nil {
			t.Fatal(err)
		}
	}
	return id
}

type searchResp struct {
	Product struct {
		ID int16 `json:"id"`
	} `json:"product"`
	Strategy           string `json:"strategy"`
	RadiusM            *int   `json:"radiusM"`
	RoutingApproximate bool   `json:"routingApproximate"`
	Results            []struct {
		Station struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Location struct {
				Lat float64 `json:"lat"`
				Lng float64 `json:"lng"`
			} `json:"location"`
		} `json:"station"`
		DistanceM      int        `json:"distanceM"`
		RouteDistanceM *int       `json:"routeDistanceM"`
		DurationS      *int       `json:"durationS"`
		Quantity       int        `json:"quantity"`
		Stale          bool       `json:"stale"`
		StockUpdatedAt time.Time  `json:"stockUpdatedAt"`
		UpdatedAgoS    int        `json:"updatedAgoS"`
		IsOpen         bool       `json:"isOpen"`
		NextOpening    *time.Time `json:"nextOpening"`
		ServedAt       *time.Time `json:"servedAt"`
	} `json:"results"`
}

func (s searchResp) names() []string {
	out := make([]string, len(s.Results))
	for i, r := range s.Results {
		out[i] = r.Station.Name
	}
	return out
}

// get envoie un GET avec des en-têtes supplémentaires.
func (c *client) get(path string, headers map[string]string) response {
	c.t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return c.send(req)
}

func searchPath(p [2]float64, product int16) string {
	return fmt.Sprintf("/api/v1/search?lat=%.7f&lng=%.7f&product_id=%d", p[0], p[1], product)
}

// searchOK cherche depuis p (installation dédiée) et décode la réponse 200.
func searchOK(t *testing.T, p [2]float64, product int16) (searchResp, response) {
	t.Helper()
	c := newClient(t)
	r := c.get(searchPath(p, product), map[string]string{"X-Install-Id": uuid.NewString()})
	expect(t, r, http.StatusOK, "")
	var out searchResp
	r.decode(t, &out)
	return out, r
}

func setOSRMMode(t *testing.T, mode int32) {
	t.Helper()
	it.osrm.mode.Store(mode)
	t.Cleanup(func() { it.osrm.mode.Store(osrmOK) })
}

func TestSearchProgressiveRadius(t *testing.T) {
	t.Run("stops at the first tier with enough stations, ranks the 10 best", func(t *testing.T) {
		product := newProduct(t)
		center, _ := cellCenter(t, calavi)
		for i := range 12 {
			seedStation(t, product, seed{name: fmt.Sprintf("near-%02d", i), at: move(center, float64(30*i), 100)})
		}
		before := it.osrm.tableCalls.Load()
		it.osrm.maxDests.Store(0)
		res, r := searchOK(t, center, product)
		if res.Strategy != search.StrategyRadius || res.RadiusM == nil || *res.RadiusM != 500 || res.RoutingApproximate {
			t.Fatalf("strategy %s radius %v approx %v", res.Strategy, res.RadiusM, res.RoutingApproximate)
		}
		if len(res.Results) != 10 || it.osrm.tableCalls.Load() != before+1 || it.osrm.maxDests.Load() > 10 {
			t.Fatalf("results %d, table calls %d, max destinations %d", len(res.Results), it.osrm.tableCalls.Load()-before, it.osrm.maxDests.Load())
		}
		for i, x := range res.Results {
			if x.DurationS == nil || x.RouteDistanceM == nil || !x.IsOpen || x.ServedAt == nil || x.Quantity != 10 {
				t.Fatalf("result %d incomplete: %+v", i, x)
			}
			if i > 0 && *x.DurationS < *res.Results[i-1].DurationS {
				t.Fatalf("not sorted by duration: %v", res.names())
			}
		}
		if r.Header().Get("X-Cache") != "MISS" || !strings.Contains(r.Header().Get("Server-Timing"), "osrm;dur=") {
			t.Fatalf("headers %v", r.Header())
		}
		if r.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("Cache-Control = %q", r.Header().Get("Cache-Control"))
		}
		// Même cellule, autre position exacte : le cache des candidats sert, le classement est refait.
		res2, r2 := searchOK(t, move(center, 40, -40), product)
		if r2.Header().Get("X-Cache") != "HIT" || len(res2.Results) != 10 || it.osrm.tableCalls.Load() != before+2 {
			t.Fatalf("second search: X-Cache %q, %d results", r2.Header().Get("X-Cache"), len(res2.Results))
		}
	})

	t.Run("widens until SEARCH_MIN_RESULTS stations are found", func(t *testing.T) {
		product := newProduct(t)
		center, margin := cellCenter(t, bohicon)
		if margin > 900 {
			t.Fatalf("unexpected H3 res 8 circumradius %.0f m", margin)
		}
		seedStation(t, product, seed{name: "a-300m", at: move(center, 300, 0)})
		seedStation(t, product, seed{name: "b-350m", at: move(center, 0, -350)})
		for i, d := range []float64{3000, 3200, 3400} {
			seedStation(t, product, seed{name: fmt.Sprintf("c-%d", i), at: move(center, -d, 0)})
		}
		seedStation(t, product, seed{name: "far-30km", at: move(center, 30_000, 0)})
		res, _ := searchOK(t, center, product)
		if res.Strategy != search.StrategyRadius || res.RadiusM == nil || *res.RadiusM != 5000 {
			t.Fatalf("strategy %s radius %v", res.Strategy, res.RadiusM)
		}
		got := strings.Join(res.names(), ",")
		if got != "a-300m,b-350m,c-0,c-1,c-2" {
			t.Fatalf("results = %s", got)
		}
	})
}

func TestSearchUnlimitedKNN(t *testing.T) {
	product := newProduct(t)
	seedStation(t, product, seed{name: "kandi-road", at: move(parakou, 80_000, 0)})
	res, _ := searchOK(t, parakou, product)
	if res.Strategy != search.StrategyFallback || res.RadiusM != nil || len(res.Results) != 1 || !res.Results[0].IsOpen {
		t.Fatalf("knn = %+v", res)
	}
	if d := res.Results[0].DistanceM; d < 79_000 || d > 81_000 {
		t.Fatalf("distance = %d", d)
	}

	// Aucune station du pays : réponse vide, pas d'erreur.
	empty, _ := searchOK(t, parakou, newProduct(t))
	if empty.Strategy != search.StrategyNone || len(empty.Results) != 0 {
		t.Fatalf("empty = %+v", empty)
	}
}

func TestSearchClosedFallbackOrder(t *testing.T) {
	product := newProduct(t)
	// Aucune station ouverte à 50 km. Ordre attendu (heure à laquelle on peut être servi) :
	// l'ouverte lointaine d'abord, puis les fermées par réouverture, puis par trajet.
	seedStation(t, product, seed{name: "open-120km", at: move(parakou, 120_000, 0)})
	seedStation(t, product, seed{name: "closed2d-60km", at: move(parakou, -60_000, -20_000), closedDays: 2})
	seedStation(t, product, seed{name: "closed2d-55km", at: move(parakou, -55_000, -10_000), closedDays: 2})
	seedStation(t, product, seed{name: "closed3d-52km", at: move(parakou, -52_000, 0), closedDays: 3})
	seedStation(t, product, seed{name: "no-hours-5km", at: move(parakou, 5_000, 0), noHours: true})

	res, _ := searchOK(t, parakou, product)
	if got := strings.Join(res.names(), ","); res.Strategy != search.StrategyFallback || got != "open-120km,closed2d-55km,closed2d-60km,closed3d-52km" {
		t.Fatalf("strategy %s, order %s", res.Strategy, got)
	}
	in2Days := time.Now().In(it.cfg.Timezone).AddDate(0, 0, 2)
	reopen := time.Date(in2Days.Year(), in2Days.Month(), in2Days.Day(), 0, 0, 0, 0, it.cfg.Timezone)
	closed := res.Results[1]
	if closed.IsOpen || closed.NextOpening == nil || !closed.NextOpening.Equal(reopen) || closed.ServedAt == nil || !closed.ServedAt.Equal(reopen) {
		t.Fatalf("closed station = %+v, want reopening %s", closed, reopen)
	}
	if open := res.Results[0]; !open.IsOpen || open.NextOpening != nil || open.ServedAt == nil || open.ServedAt.After(time.Now().Add(5*time.Hour)) {
		t.Fatalf("open station = %+v", open)
	}
}

func TestSearchExclusions(t *testing.T) {
	product, other := newProduct(t), newProduct(t)
	center, _ := cellCenter(t, calavi)
	p := func(i int) [2]float64 { return move(center, 800, float64(i)*150) }
	seedStation(t, product, seed{name: "ok", at: p(0)})
	seedStation(t, product, seed{name: "stale-10h", at: p(1), age: 10 * time.Hour})
	seedStation(t, product, seed{name: "expired-25h", at: p(2), age: 25 * time.Hour})
	seedStation(t, product, seed{name: "no-hours", at: p(3), noHours: true})
	notSold := seedStation(t, product, seed{name: "not-sold", at: p(4), qty: -1})
	if _, err := it.pool.Exec(t.Context(), `INSERT INTO station_stocks (station_id, product_id, quantity) VALUES ($1, $2, 50)`, notSold, other); err != nil {
		t.Fatal(err)
	}
	seedStation(t, product, seed{name: "zero", at: p(5), zero: true})
	seedStation(t, product, seed{name: "suspended", at: p(6), status: "suspended"})
	seedStation(t, product, seed{name: "pending", at: p(7), status: "pending"})
	seedStation(t, product, seed{name: "closed-today", at: p(8), closedDays: 1})

	res, _ := searchOK(t, center, product)
	if got := strings.Join(res.names(), ","); got != "ok,stale-10h" {
		t.Fatalf("results = %s", got)
	}
	ok, stale := res.Results[0], res.Results[1]
	if ok.Stale || !stale.Stale || stale.UpdatedAgoS < 10*3600-60 || stale.UpdatedAgoS > 10*3600+60 {
		t.Fatalf("stale flags: ok %+v stale %+v", ok, stale)
	}
	// Deux stations ouvertes seulement (< SEARCH_MIN_RESULTS) : la recherche est allée jusqu'à 50 km.
	if res.RadiusM == nil || *res.RadiusM != 50_000 {
		t.Fatalf("radius = %v", res.RadiusM)
	}
}

// outsideBenin renvoie un point à l'est de Cotonou (Nigeria), à au moins minKm de la frontière.
func outsideBenin(t *testing.T, minKm float64) [2]float64 {
	t.Helper()
	for lng := 2.62; lng < 4; lng += 0.005 {
		var dist float64
		var covered bool
		err := it.pool.QueryRow(t.Context(), `SELECT ST_Distance(boundary, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography),
			ST_Covers(boundary, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) FROM country_boundaries WHERE code = 'BEN'`,
			6.45, lng).Scan(&dist, &covered)
		if err != nil {
			t.Fatal(err)
		}
		if !covered && dist >= minKm*1000 {
			return [2]float64{6.45, lng}
		}
	}
	t.Fatalf("no point found %.0f km outside Benin", minKm)
	return [2]float64{}
}

func TestSearchCoverage(t *testing.T) {
	product := newProduct(t)
	near := outsideBenin(t, 10)
	seedStation(t, product, seed{name: "seme", at: [2]float64{6.38, 2.60}})

	before := it.osrm.tableCalls.Load()
	res, _ := searchOK(t, near, product)
	if !res.RoutingApproximate || len(res.Results) != 1 || res.Results[0].DurationS == nil || res.Results[0].RouteDistanceM != nil {
		t.Fatalf("10 km outside: %+v", res)
	}
	if it.osrm.tableCalls.Load() != before {
		t.Fatal("OSRM must not be called outside Benin")
	}

	c := newClient(t)
	expect(t, c.get(searchPath(outsideBenin(t, 50), product), nil), http.StatusUnprocessableEntity, search.CodeOutOfCoverage)
	expect(t, c.get(searchPath([2]float64{48.8566, 2.3522}, product), nil), http.StatusUnprocessableEntity, search.CodeOutOfCoverage)

	// Paramètres invalides.
	expect(t, c.get("/api/v1/search?lat=91&lng=2.4&product_id=1", nil), http.StatusUnprocessableEntity, apperr.CodeValidation)
	expect(t, c.get("/api/v1/search?lat=6.4&lng=abc&product_id=1", nil), http.StatusUnprocessableEntity, apperr.CodeValidation)
	expect(t, c.get("/api/v1/search?lat=6.4&lng=2.4", nil), http.StatusUnprocessableEntity, apperr.CodeValidation)
	expect(t, c.get("/api/v1/search?lat=6.4&lng=2.4&product_id=32000", nil), http.StatusUnprocessableEntity, apperr.CodeValidation)
}

func TestSearchOSRMFailureFallsBack(t *testing.T) {
	product := newProduct(t)
	center, _ := cellCenter(t, bohicon)
	seedStation(t, product, seed{name: "s-2km", at: move(center, 2000, 0)})
	seedStation(t, product, seed{name: "s-1km", at: move(center, 0, 1000)})
	seedStation(t, product, seed{name: "s-3km", at: move(center, -3000, 0)})

	for _, mode := range []int32{osrmError, osrmTimeout, osrmHangUp} {
		t.Run(fmt.Sprint("mode ", mode), func(t *testing.T) {
			setOSRMMode(t, mode)
			start := time.Now()
			res, _ := searchOK(t, center, product)
			if !res.RoutingApproximate || strings.Join(res.names(), ",") != "s-1km,s-2km,s-3km" {
				t.Fatalf("fallback = %+v", res)
			}
			for _, x := range res.Results {
				if x.DurationS == nil || x.RouteDistanceM != nil || x.ServedAt == nil {
					t.Fatalf("approximate result %+v", x)
				}
			}
			if time.Since(start) > 2*time.Second {
				t.Fatalf("fallback took %s", time.Since(start))
			}
		})
	}
}

func TestSearchCacheInvalidationOnStockChange(t *testing.T) {
	product := newProduct(t)
	admin := adminClient(t)
	m, stationID := approvedManager(t, admin)
	center, _ := cellCenter(t, move(calavi, 5000, 0))
	expect(t, pin(t, m, move(center, 200, 0), nil), http.StatusOK, "")
	expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/opening-hours", etag(t, m, "/api/v1/manager/station/opening-hours"),
		map[string]any{"allWeek24h": true}), http.StatusOK, "")
	expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/products", etag(t, m, "/api/v1/manager/station/products"),
		map[string]any{"productIds": []int16{product}}), http.StatusOK, "")
	setStock := func(q int) {
		expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/stocks", etag(t, m, "/api/v1/manager/station/stocks"),
			map[string]any{"items": []map[string]int{{"productId": int(product), "quantity": q}}}), http.StatusOK, "")
	}
	setStock(7)

	res, r := searchOK(t, center, product)
	if r.Header().Get("X-Cache") != "MISS" || len(res.Results) != 1 || res.Results[0].Station.ID != stationID || res.Results[0].Quantity != 7 {
		t.Fatalf("first search: %s %+v", r.Header().Get("X-Cache"), res)
	}
	if _, r = searchOK(t, center, product); r.Header().Get("X-Cache") != "HIT" {
		t.Fatal("second search should hit the cache")
	}
	setStock(0)
	res, r = searchOK(t, center, product)
	if r.Header().Get("X-Cache") != "MISS" || len(res.Results) != 0 {
		t.Fatalf("after stock 0: %s %+v", r.Header().Get("X-Cache"), res)
	}
	setStock(3)
	if res, _ = searchOK(t, center, product); len(res.Results) != 1 || res.Results[0].Quantity != 3 {
		t.Fatalf("after restock: %+v", res)
	}
	// Suspension : la station disparaît immédiatement.
	d := admin.do(http.MethodGet, "/api/v1/admin/stations/"+stationID, nil)
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/stations/"+stationID+"/suspend", d.Header().Get("ETag"),
		map[string]string{"reason": "Contrôle en cours"}), http.StatusOK, "")
	if res, _ = searchOK(t, center, product); len(res.Results) != 0 {
		t.Fatalf("suspended station still listed: %+v", res)
	}
}

func TestSearchRateLimits(t *testing.T) {
	product := newProduct(t)
	seedStation(t, product, seed{at: calavi})
	c := newClient(t)
	install := map[string]string{"X-Install-Id": uuid.NewString()}
	path := searchPath(calavi, product)
	for range it.cfg.Search.RateLimitClient {
		expect(t, c.get(path, install), http.StatusOK, "")
	}
	r := c.get(path, install)
	expect(t, r, http.StatusTooManyRequests, apperr.CodeRateLimited)
	if r.Header().Get("Retry-After") == "" {
		t.Fatal("429 without Retry-After")
	}
	// Autre installation derrière la même IP (CGNAT) : quota propre.
	expect(t, c.get(path, map[string]string{"X-Install-Id": uuid.NewString()}), http.StatusOK, "")
	// Sans en-tête, le quota par installation s'applique à l'IP : l'omettre n'aide pas.
	bare := newClient(t)
	for range it.cfg.Search.RateLimitClient {
		expect(t, bare.get(path, nil), http.StatusOK, "")
	}
	expect(t, bare.get(path, nil), http.StatusTooManyRequests, apperr.CodeRateLimited)

	// Quota par IP : 300/min, quelles que soient les installations.
	shared := newClient(t)
	for i := range it.cfg.Search.RateLimitIP {
		if r := shared.get(path, map[string]string{"X-Install-Id": uuid.NewString()}); r.Code != http.StatusOK {
			t.Fatalf("request %d: %d", i, r.Code)
		}
	}
	expect(t, shared.get(path, map[string]string{"X-Install-Id": uuid.NewString()}), http.StatusTooManyRequests, apperr.CodeRateLimited)
}

func TestSearchStatsAggregation(t *testing.T) {
	ctx := t.Context()
	if _, err := it.svc.Stats.Flush(ctx); err != nil { // compteurs des autres tests
		t.Fatal(err)
	}
	product := newProduct(t)
	served := move(calavi, 20_000, 0)
	shortage := parakou
	seedStation(t, product, seed{at: move(served, 1000, 0)})
	seedStation(t, product, seed{at: move(shortage, 20_000, 0)}) // à 20 km : pénurie à 5 km
	for range 3 {
		searchOK(t, served, product)
	}
	for range 2 {
		searchOK(t, move(shortage, 50, 50), product)
	}
	rows, err := it.svc.Stats.Flush(ctx)
	if err != nil || rows < 2 {
		t.Fatalf("flush: %d rows, %v", rows, err)
	}
	cell := func(p [2]float64) int64 {
		c, err := h3.CellAt(p[0], p[1], h3.ResStats)
		if err != nil {
			t.Fatal(err)
		}
		return h3.ToInt64(c)
	}
	type stat struct{ searches, empty int }
	got := map[int64]stat{}
	q, err := it.pool.Query(ctx, `SELECT h3_r7, searches, empty_within_5km, bucket FROM search_stats WHERE product_id = $1`, product)
	if err != nil {
		t.Fatal(err)
	}
	for q.Next() {
		var c int64
		var s stat
		var bucket time.Time
		if err := q.Scan(&c, &s.searches, &s.empty, &bucket); err != nil {
			t.Fatal(err)
		}
		if !bucket.Equal(bucket.Truncate(time.Hour)) {
			t.Fatalf("bucket %s not truncated to the hour", bucket)
		}
		got[c] = s
	}
	if len(got) != 2 || got[cell(served)] != (stat{3, 0}) || got[cell(shortage)] != (stat{2, 2}) {
		t.Fatalf("search_stats = %+v", got)
	}
	// Un second vidage ajoute aux compteurs existants (même tranche horaire).
	searchOK(t, served, product)
	if _, err := it.svc.Stats.Flush(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := it.pool.QueryRow(ctx, `SELECT searches FROM search_stats WHERE product_id = $1 AND h3_r7 = $2`, product, cell(served)).Scan(&n); err != nil || n != 4 {
		t.Fatalf("after second flush: %d (%v)", n, err)
	}
	keys, err := it.rdb.Keys(ctx, "stats:search:*").Result()
	if err != nil || len(keys) != 0 {
		t.Fatalf("stats keys left in Redis: %v (%v)", keys, err)
	}

	// Tranche restée en attente après un échec + nouvelle tranche vivante pour la même heure :
	// aucune perte (la vivante attend le vidage suivant au lieu d'écraser l'autre).
	key := fmt.Sprintf("stats:search:%d", time.Now().UTC().Truncate(time.Hour).Unix())
	field := fmt.Sprintf("%d:%d:s", cell(served), product)
	it.rdb.HIncrBy(ctx, key+":flushing", field, 5)
	it.rdb.HIncrBy(ctx, key, field, 2)
	for range 2 {
		if _, err := it.svc.Stats.Flush(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if err := it.pool.QueryRow(ctx, `SELECT searches FROM search_stats WHERE product_id = $1 AND h3_r7 = $2`, product, cell(served)).Scan(&n); err != nil || n != 11 {
		t.Fatalf("after pending + live buckets: %d (%v), want 11", n, err)
	}
}

func TestNoUserCoordinatesInLogsOrCache(t *testing.T) {
	product := newProduct(t)
	// Position de l'utilisateur, reconnaissable dans tous ses formats d'écriture.
	user := [2]float64{6.4012345, 2.3456789}
	stationID := seedStation(t, product, seed{at: move(user, 1500, 1200)})
	needles := []string{"6.401234", "6.40123", "2.345678", "2.34568", "6.4012", "2.3456"}

	c := newClient(t)
	install := map[string]string{"X-Install-Id": uuid.NewString()}
	routePath := fmt.Sprintf("/api/v1/routes?lat=%.7f&lng=%.7f&station_id=%s", user[0], user[1], stationID)
	expect(t, c.get(searchPath(user, product), install), http.StatusOK, "")
	expect(t, c.get(routePath, install), http.StatusOK, "")
	for _, mode := range []int32{osrmError, osrmTimeout, osrmHangUp} {
		it.osrm.mode.Store(mode)
		expect(t, c.get(searchPath(move(user, 1, 1), product), install), http.StatusOK, "")
		expect(t, c.get(routePath, install), http.StatusServiceUnavailable, search.CodeRoutingDown)
	}
	it.osrm.mode.Store(osrmOK)
	expect(t, c.get(fmt.Sprintf("/api/v1/search?lat=%.7f&lng=%.7f&product_id=abc", user[0], user[1]), install), http.StatusUnprocessableEntity, apperr.CodeValidation)

	logs := it.logs.String()
	for _, n := range needles {
		if strings.Contains(logs, n) {
			i := strings.Index(logs, n)
			t.Fatalf("user coordinate %q found in logs: …%s…", n, logs[max(0, i-200):min(len(logs), i+100)])
		}
	}
	if !strings.Contains(logs, "lat=***") || !strings.Contains(logs, "product_id="+fmt.Sprint(product)) {
		t.Fatal("access log should keep the masked query string")
	}
	if !strings.Contains(logs, "routing unavailable") {
		t.Fatal("OSRM failures should still be logged (without coordinates)")
	}

	// Redis : ni les clés ni les valeurs ne contiennent la position de l'utilisateur.
	keys, err := it.rdb.Keys(t.Context(), "*").Result()
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range keys {
		dump := k
		if typ, _ := it.rdb.Type(t.Context(), k).Result(); typ == "string" {
			v, _ := it.rdb.Get(t.Context(), k).Result()
			dump += " " + v
		} else if typ == "hash" {
			v, _ := it.rdb.HGetAll(t.Context(), k).Result()
			dump += fmt.Sprint(v)
		}
		for _, n := range needles {
			if strings.Contains(dump, n) {
				t.Fatalf("user coordinate %q found in Redis key %s", n, k)
			}
		}
	}
	// Base : aucune table ne reçoit la position (les stats ne gardent que la cellule res 7).
	var leaked int
	if err := it.pool.QueryRow(t.Context(), `SELECT count(*) FROM audit_logs WHERE metadata::text LIKE '%6.4012%' OR metadata::text LIKE '%2.3456%'`).Scan(&leaked); err != nil || leaked != 0 {
		t.Fatalf("coordinates in audit_logs: %d (%v)", leaked, err)
	}
}

func TestRoute(t *testing.T) {
	product := newProduct(t)
	from := move(calavi, -2000, 0)
	stationID := seedStation(t, product, seed{at: calavi})
	pending := seedStation(t, product, seed{at: move(calavi, 100, 0), status: "pending"})
	c := newClient(t)
	path := func(p [2]float64, id string) string {
		return fmt.Sprintf("/api/v1/routes?lat=%.6f&lng=%.6f&station_id=%s", p[0], p[1], id)
	}

	r := c.get(path(from, stationID.String()), nil)
	expect(t, r, http.StatusOK, "")
	var route struct {
		StationID string `json:"stationId"`
		DistanceM int    `json:"distanceM"`
		DurationS int    `json:"durationS"`
		Geometry  string `json:"geometry"`
		Encoding  string `json:"geometryEncoding"`
		Steps     []map[string]any
	}
	r.decode(t, &route)
	if route.StationID != stationID.String() || route.DistanceM < 2000 || route.DurationS <= 0 || route.Geometry == "" || route.Encoding != "polyline6" || len(route.Steps) != 3 {
		t.Fatalf("route = %+v", route)
	}
	turn := route.Steps[1]
	man, _ := turn["maneuver"].(map[string]any)
	if man["type"] != "end of road" || man["modifier"] != "right" || turn["name"] != "Boulevard de la Marina" || turn["distanceM"] == nil || turn["durationS"] == nil || man["location"] == nil {
		t.Fatalf("step = %+v", turn)
	}
	if _, hasText := turn["instruction"]; hasText {
		t.Fatal("steps must not carry text: the mobile app translates them (osrm-text-instructions)")
	}

	expect(t, c.get(path(from, pending.String()), nil), http.StatusNotFound, apperr.CodeNotFound)
	expect(t, c.get(path(from, uuid.NewString()), nil), http.StatusNotFound, apperr.CodeNotFound)
	expect(t, c.get(path(from, "nope"), nil), http.StatusUnprocessableEntity, apperr.CodeValidation)
	expect(t, c.get(path(outsideBenin(t, 10), stationID.String()), nil), http.StatusUnprocessableEntity, search.CodeOutOfCoverage)
	setOSRMMode(t, osrmError)
	expect(t, c.get(path(from, stationID.String()), nil), http.StatusServiceUnavailable, search.CodeRoutingDown)
}

func TestPublicStation(t *testing.T) {
	fresh, stale, expired := newProduct(t), newProduct(t), newProduct(t)
	id := seedStation(t, fresh, seed{name: "Station publique", at: calavi})
	for p, age := range map[int16]time.Duration{stale: 10 * time.Hour, expired: 30 * time.Hour} {
		if _, err := it.pool.Exec(t.Context(), `INSERT INTO station_stocks (station_id, product_id, quantity, updated_at, last_confirmed_at)
			VALUES ($1, $2, 25, now() - $3::interval, now() - $3::interval)`, id, p, age.String()); err != nil {
			t.Fatal(err)
		}
	}
	tomorrow := time.Now().In(it.cfg.Timezone).AddDate(0, 0, 1).Format(time.DateOnly)
	if _, err := it.pool.Exec(t.Context(), `INSERT INTO station_closures (station_id, closed_on) VALUES ($1, $2::date)`, id, tomorrow); err != nil {
		t.Fatal(err)
	}

	c := newClient(t)
	r := c.do(http.MethodGet, "/api/v1/stations/"+id.String(), nil)
	expect(t, r, http.StatusOK, "")
	var st struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Location *struct {
			Lat float64 `json:"lat"`
		} `json:"location"`
		Hours struct {
			Timezone  string `json:"timezone"`
			IsOpenNow bool   `json:"isOpenNow"`
			Days      []struct {
				Weekday int  `json:"weekday"`
				Is24h   bool `json:"is24h"`
			} `json:"days"`
			Closures []string `json:"closures"`
		} `json:"openingHours"`
		Stocks []struct {
			ProductID int16  `json:"productId"`
			Quantity  *int   `json:"quantity"`
			Freshness string `json:"freshness"`
		} `json:"stocks"`
	}
	r.decode(t, &st)
	if st.Name != "Station publique" || st.Location == nil || !st.Hours.IsOpenNow || len(st.Hours.Days) != 7 || !st.Hours.Days[0].Is24h ||
		st.Hours.Timezone != "Africa/Porto-Novo" || len(st.Hours.Closures) != 1 || st.Hours.Closures[0] != tomorrow {
		t.Fatalf("station = %+v", st)
	}
	want := map[int16]string{fresh: station.FreshnessFresh, stale: station.FreshnessStale, expired: station.FreshnessExpired}
	if len(st.Stocks) != 3 {
		t.Fatalf("stocks = %+v", st.Stocks)
	}
	for _, s := range st.Stocks {
		if s.Freshness != want[s.ProductID] || (s.Freshness == station.FreshnessExpired) != (s.Quantity == nil) {
			t.Fatalf("stock %+v", s)
		}
	}
	// Données du gérant jamais publiques.
	for _, secret := range []string{"ifu", "rccm", "phone", "document", "manager"} {
		if strings.Contains(strings.ToLower(r.Body.String()), `"`+secret) {
			t.Fatalf("public station exposes %q: %s", secret, r.Body.String())
		}
	}

	pending := seedStation(t, fresh, seed{at: calavi, status: "pending"})
	expect(t, c.do(http.MethodGet, "/api/v1/stations/"+pending.String(), nil), http.StatusNotFound, apperr.CodeNotFound)
	expect(t, c.do(http.MethodGet, "/api/v1/stations/not-a-uuid", nil), http.StatusBadRequest, apperr.CodeInvalidParameter)
}

func TestSearchUsesGiSTIndex(t *testing.T) {
	ctx := t.Context()
	tx, err := it.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Volume réaliste (5 000 stations approuvées réparties sur le pays), statistiques à jour ;
	// tout est annulé en fin de test, ANALYZE compris.
	if _, err := tx.Exec(ctx, `INSERT INTO stations (status, name, ifu, rccm, address, phone, location)
		SELECT 'approved', 'gist-' || g, lpad(g::text, 13, '0'), 'RB', 'x', 'x',
		       ST_SetSRID(ST_MakePoint(1.0 + random() * 2.6, 6.3 + random() * 6.0), 4326)::geography
		FROM generate_series(1, 5000) AS g`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `ANALYZE stations`); err != nil {
		t.Fatal(err)
	}
	for name, q := range map[string]string{
		"radius": `SELECT s.id FROM stations s
			WHERE s.status = 'approved' AND s.location IS NOT NULL
			  AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint(2.42, 6.37), 4326)::geography, 5000)`,
		"knn": `SELECT s.id FROM stations s
			WHERE s.status = 'approved' AND s.location IS NOT NULL
			ORDER BY s.location <-> ST_SetSRID(ST_MakePoint(2.42, 6.37), 4326)::geography LIMIT 10`,
	} {
		rows, err := tx.Query(ctx, "EXPLAIN "+q)
		if err != nil {
			t.Fatal(err)
		}
		var lines []string
		for rows.Next() {
			var l string
			if err := rows.Scan(&l); err != nil {
				t.Fatal(err)
			}
			lines = append(lines, l)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		if plan := strings.Join(lines, "\n"); !strings.Contains(plan, "idx_stations_location_approved") {
			t.Errorf("%s: GiST index not used:\n%s", name, plan)
		}
	}
}
