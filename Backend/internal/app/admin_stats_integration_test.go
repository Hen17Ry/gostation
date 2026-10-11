//go:build integration

package app_test

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"testing"
	"time"

	"gostation/backend/internal/platform/h3"
)

// statsCell renvoie la cellule H3 res 7 d'une position.
func statsCell(t *testing.T, p [2]float64) h3.Cell {
	t.Helper()
	c, err := h3.CellAt(p[0], p[1], h3.ResStats)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// recordStats écrit des compteurs de recherche pour une heure passée, exactement comme le
// Recorder (clé Redis de l'heure, champs « cellule:produit:s|e »), puis les vide en base par le
// vrai chemin du worker (search_stats et ses agrégats).
func recordStats(t *testing.T, at time.Time, cell h3.Cell, product int16, searches, empty int) {
	t.Helper()
	key := "stats:search:" + strconv.FormatInt(at.UTC().Truncate(time.Hour).Unix(), 10)
	field := strconv.FormatInt(h3.ToInt64(cell), 10) + ":" + strconv.Itoa(int(product))
	if err := it.rdb.HIncrBy(t.Context(), key, field+":s", int64(searches)).Err(); err != nil {
		t.Fatal(err)
	}
	if empty > 0 {
		if err := it.rdb.HIncrBy(t.Context(), key, field+":e", int64(empty)).Err(); err != nil {
			t.Fatal(err)
		}
	}
}

func flushStats(t *testing.T) {
	t.Helper()
	if _, err := it.svc.Stats.Flush(t.Context()); err != nil {
		t.Fatal(err)
	}
}

func day(n int) string { return localTime(-n, 12, 0).Format(time.DateOnly) }

type kpiResp struct {
	Value    float64  `json:"value"`
	Previous float64  `json:"previous"`
	Change   *float64 `json:"change"`
}

type dashboardResp struct {
	Stations struct {
		ByStatus            map[string]int `json:"byStatus"`
		PendingApplications struct {
			Count       int        `json:"count"`
			OldestSince *time.Time `json:"oldestSince"`
		} `json:"pendingApplications"`
	} `json:"stations"`
	StockFreshness struct {
		Fresh, Stale, Expired, Total int
	} `json:"stockFreshness"`
	InactiveManagers int `json:"inactiveManagers"`
	Searches         struct {
		Total     kpiResp `json:"total"`
		EmptyRate kpiResp `json:"emptyRate"`
		ByProduct []struct {
			Product struct {
				ID int16 `json:"id"`
			} `json:"product"`
			kpiResp
		} `json:"byProduct"`
	} `json:"searches"`
	Shortages struct {
		Zones int `json:"zones"`
		Top   []struct {
			Cell          string  `json:"cell"`
			Searches      int64   `json:"searches"`
			EmptySearches int64   `json:"emptySearches"`
			EmptyRate     float64 `json:"emptyRate"`
		} `json:"top"`
	} `json:"shortages"`
	Reports struct {
		Open    int     `json:"open"`
		Created kpiResp `json:"created"`
	} `json:"reports"`
	Alerts struct {
		Open int `json:"open"`
	} `json:"alerts"`
	Registrations struct {
		Users    kpiResp `json:"users"`
		Managers kpiResp `json:"managers"`
	} `json:"registrations"`
	Series struct {
		Searches []struct {
			At        time.Time        `json:"at"`
			Searches  int64            `json:"searches"`
			ByProduct map[string]int64 `json:"byProduct"`
		} `json:"searches"`
		Freshness []struct {
			Fresh *int `json:"fresh"`
			Stale *int `json:"stale"`
		} `json:"freshness"`
	} `json:"series"`
}

func dashboard(t *testing.T, admin *client, query string) dashboardResp {
	t.Helper()
	r := admin.do(http.MethodGet, "/api/v1/admin/dashboard"+query, nil)
	expect(t, r, http.StatusOK, "")
	var d dashboardResp
	r.decode(t, &d)
	return d
}

func insertUserAt(t *testing.T, role string, at time.Time) {
	t.Helper()
	if _, err := it.pool.Exec(t.Context(), `INSERT INTO users (role, email, password_hash, first_name, last_name,
		privacy_policy_version, privacy_accepted_at, created_at) VALUES ($1::user_role, $2, '!', 'Hist', 'Orique', '1.0', $3, $3)`,
		role, uniqueEmail("hist"), at); err != nil {
		t.Fatal(err)
	}
}

func insertReportAt(t *testing.T, stationID string, at time.Time) {
	t.Helper()
	if _, err := it.pool.Exec(t.Context(), `INSERT INTO reports (station_id, reason, created_at) VALUES ($1, 'wrong_location', $2)`, stationID, at); err != nil {
		t.Fatal(err)
	}
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestAdminDashboard(t *testing.T) {
	admin := adminClient(t)
	gasA, gasB := newProduct(t), newProduct(t)
	x, y, z := statsCell(t, [2]float64{9.0, 1.2}), statsCell(t, [2]float64{9.6, 2.9}), statsCell(t, [2]float64{10.2, 1.6})
	at := func(n, h int) time.Time { return localTime(-n, h, 0) }

	// Période passée (J-200 à J-194) et période précédente (J-207 à J-201) : seules ces données y figurent.
	recordStats(t, at(200, 10), x, gasA, 10, 6)
	recordStats(t, at(199, 10), x, gasA, 10, 6)
	recordStats(t, at(198, 10), x, gasA, 10, 6)
	recordStats(t, at(197, 9), y, gasA, 20, 2)
	recordStats(t, at(196, 9), z, gasA, 4, 4) // < 5 recherches : cellule masquée
	recordStats(t, at(195, 15), x, gasB, 10, 8)
	recordStats(t, at(204, 9), y, gasA, 32, 4)
	flushStats(t)
	station := seedStation(t, gasA, seed{at: offset(parakou, 52000)}).String()
	insertReportAt(t, station, at(199, 11))
	insertReportAt(t, station, at(196, 11))
	insertReportAt(t, station, at(203, 11))
	insertUserAt(t, "user", at(198, 8))
	insertUserAt(t, "user", at(194, 20))
	insertUserAt(t, "manager", at(197, 8))
	insertUserAt(t, "user", at(205, 8))
	for _, f := range []struct {
		h            int
		fresh, stale int
	}{{10, 10, 4}, {11, 20, 6}} {
		if _, err := it.pool.Exec(t.Context(), `INSERT INTO stock_freshness_stats (bucket, product_id, fresh, stale, expired) VALUES ($1, $2, $3, $4, 2)`,
			at(200, f.h).UTC(), gasA, f.fresh, f.stale); err != nil {
			t.Fatal(err)
		}
	}

	d := dashboard(t, admin, "?period=custom&from="+day(200)+"&to="+day(194))
	if d.Searches.Total.Value != 64 || d.Searches.Total.Previous != 32 || d.Searches.Total.Change == nil || !near(*d.Searches.Total.Change, 1) {
		t.Fatalf("searches = %+v, want 64 vs 32 (+100 %%)", d.Searches.Total)
	}
	if !near(d.Searches.EmptyRate.Value, 0.5) || !near(d.Searches.EmptyRate.Previous, 0.125) {
		t.Fatalf("empty rate = %+v, want 0.5 vs 0.125", d.Searches.EmptyRate)
	}
	byProduct := map[int16]kpiResp{}
	for _, p := range d.Searches.ByProduct {
		byProduct[p.Product.ID] = p.kpiResp
	}
	if byProduct[gasA].Value != 54 || byProduct[gasA].Previous != 32 || byProduct[gasB].Value != 10 || byProduct[gasB].Change != nil {
		t.Fatalf("searches by product = %+v", byProduct)
	}
	if d.Shortages.Zones != 1 || len(d.Shortages.Top) != 1 || d.Shortages.Top[0].Cell != x.String() ||
		d.Shortages.Top[0].Searches != 40 || d.Shortages.Top[0].EmptySearches != 26 || !near(d.Shortages.Top[0].EmptyRate, 0.65) {
		t.Fatalf("shortages = %+v, want only cell X (40 searches, 26 without a station)", d.Shortages)
	}
	if d.Reports.Created.Value != 2 || d.Reports.Created.Previous != 1 {
		t.Fatalf("reports created = %+v", d.Reports.Created)
	}
	if d.Registrations.Users.Value != 2 || d.Registrations.Users.Previous != 1 || d.Registrations.Managers.Value != 1 {
		t.Fatalf("registrations = %+v", d.Registrations)
	}
	want := []int64{10, 10, 10, 20, 4, 10, 0}
	if len(d.Series.Searches) != 7 {
		t.Fatalf("%d daily points, want 7", len(d.Series.Searches))
	}
	for i, p := range d.Series.Searches {
		if p.Searches != want[i] || !p.At.Equal(localTime(-200+i, 0, 0)) {
			t.Fatalf("series[%d] = %+v, want %d searches on %s", i, p, want[i], localTime(-200+i, 0, 0))
		}
	}
	if fr := d.Series.Freshness; len(fr) != 7 || fr[0].Fresh == nil || *fr[0].Fresh != 15 || *fr[0].Stale != 5 || fr[1].Fresh != nil {
		t.Fatalf("freshness series = %+v, want day 1 averaged (15 fresh, 5 stale), then no snapshot", fr)
	}

	// Indicateurs instantanés : évolution entre deux appels autour de changements connus.
	before := dashboard(t, admin, "")
	pendingManager(t)
	seedStation(t, gasA, seed{at: offset(parakou, 52500), age: time.Hour})
	seedStation(t, gasA, seed{at: offset(parakou, 53000), age: 10 * time.Hour})
	seedStation(t, gasA, seed{at: offset(parakou, 53500), age: 30 * time.Hour})
	if _, err := it.pool.Exec(t.Context(), `INSERT INTO admin_alerts (kind, station_id) VALUES ('manager_inactive', $1)`, station); err != nil {
		t.Fatal(err)
	}
	insertReportAt(t, station, time.Now())
	w := statsCell(t, [2]float64{11.85, 3.38})
	recordStats(t, time.Now().Add(-time.Hour), w, gasA, 7, 7)
	flushStats(t)
	after := dashboard(t, admin, "")
	deltas := map[string][2]int{
		"pending":          {before.Stations.PendingApplications.Count, after.Stations.PendingApplications.Count},
		"approved":         {before.Stations.ByStatus["approved"], after.Stations.ByStatus["approved"]},
		"fresh":            {before.StockFreshness.Fresh, after.StockFreshness.Fresh},
		"stale":            {before.StockFreshness.Stale, after.StockFreshness.Stale},
		"expired":          {before.StockFreshness.Expired, after.StockFreshness.Expired},
		"inactiveManagers": {before.InactiveManagers, after.InactiveManagers},
		"openAlerts":       {before.Alerts.Open, after.Alerts.Open},
		"openReports":      {before.Reports.Open, after.Reports.Open},
		"reportsCreated":   {int(before.Reports.Created.Value), int(after.Reports.Created.Value)},
		"searches":         {int(before.Searches.Total.Value), int(after.Searches.Total.Value)},
	}
	wantDelta := map[string]int{
		"pending": 1, "approved": 3, "fresh": 1, "stale": 1, "expired": 1, "inactiveManagers": 1, "openAlerts": 1,
		"openReports": 1, "reportsCreated": 1, "searches": 7,
	}
	for k, v := range deltas {
		if v[1]-v[0] != wantDelta[k] {
			t.Errorf("%s: %d → %d, want +%d", k, v[0], v[1], wantDelta[k])
		}
	}
	if after.Stations.PendingApplications.OldestSince == nil {
		t.Error("oldest pending application missing")
	}

	// Relevé horaire de la fraîcheur (tâche stats:freshness du worker).
	n, err := it.svc.Analytics.SnapshotFreshness(t.Context())
	if err != nil || n == 0 {
		t.Fatalf("freshness snapshot = %d, %v", n, err)
	}
	var fresh int
	if err := it.pool.QueryRow(t.Context(), `SELECT fresh FROM stock_freshness_stats WHERE bucket = date_trunc('hour', now()) AND product_id = $1`, gasA).Scan(&fresh); err != nil || fresh < 1 {
		t.Fatalf("snapshot for product %d = %d (%v)", gasA, fresh, err)
	}

	// Stats des recherches, tous lieux confondus : totaux, répartition par heure, filtre produit.
	var st struct {
		Totals struct {
			Searches kpiResp `json:"searches"`
		} `json:"totals"`
		ByHourOfDay []struct {
			Hour     int   `json:"hour"`
			Searches int64 `json:"searches"`
		} `json:"byHourOfDay"`
	}
	admin.do(http.MethodGet, "/api/v1/admin/stats/searches?period=custom&from="+day(200)+"&to="+day(194), nil).decode(t, &st)
	if st.Totals.Searches.Value != 64 || len(st.ByHourOfDay) != 24 || st.ByHourOfDay[10].Searches != 30 ||
		st.ByHourOfDay[9].Searches != 24 || st.ByHourOfDay[15].Searches != 10 || st.ByHourOfDay[12].Searches != 0 {
		t.Fatalf("search stats = %+v", st)
	}
	admin.do(http.MethodGet, fmt.Sprintf("/api/v1/admin/stats/searches?period=custom&from=%s&to=%s&productId=%d", day(200), day(194), gasB), nil).decode(t, &st)
	if st.Totals.Searches.Value != 10 || st.ByHourOfDay[15].Searches != 10 || st.ByHourOfDay[10].Searches != 0 {
		t.Fatalf("search stats for product B = %+v", st)
	}

	// Validation des périodes.
	for _, q := range []string{
		"?period=1y", "?period=custom&from=" + day(10), "?period=custom&from=" + day(1) + "&to=" + day(5),
		"?period=custom&from=" + day(0) + "&to=" + localTime(1, 12, 0).Format(time.DateOnly), "?period=custom&from=" + day(400) + "&to=" + day(0),
		"?period=7d&from=" + day(3),
	} {
		expect(t, admin.do(http.MethodGet, "/api/v1/admin/dashboard"+q, nil), http.StatusUnprocessableEntity, "request.validation_failed")
	}
}

type shortageResp struct {
	Type        string `json:"type"`
	K           int    `json:"k"`
	MaskedCells int    `json:"maskedCells"`
	Features    []struct {
		ID       string `json:"id"`
		Geometry struct {
			Type        string         `json:"type"`
			Coordinates [][][2]float64 `json:"coordinates"`
		} `json:"geometry"`
		Properties struct {
			Searches      int64   `json:"searches"`
			EmptySearches int64   `json:"emptySearches"`
			EmptyRate     float64 `json:"emptyRate"`
			Shortage      bool    `json:"shortage"`
		} `json:"properties"`
	} `json:"features"`
}

func TestAdminShortagesThresholdAndAnonymity(t *testing.T) {
	admin := adminClient(t)
	gasA, gasB := newProduct(t), newProduct(t)
	cell := func(lat, lng float64) h3.Cell { return statsCell(t, [2]float64{lat, lng}) }
	p, q, r, s, tc := cell(8.0, 1.5), cell(8.2, 2.0), cell(8.4, 2.5), cell(8.6, 1.9), cell(8.8, 2.3)
	at := localTime(-150, 14, 0)
	recordStats(t, at, p, gasA, 10, 5) // 50 % : pénurie (seuil inclus)
	recordStats(t, at, q, gasA, 10, 4) // 40 %
	recordStats(t, at, r, gasA, 4, 4)  // 4 recherches : masquée
	recordStats(t, at, s, gasB, 6, 6)
	recordStats(t, at, tc, gasA, 3, 3) // 3 + 3 = 6 tous produits ; 3 par produit : masquée
	recordStats(t, at, tc, gasB, 3, 0)
	flushStats(t)

	get := func(query string) shortageResp {
		t.Helper()
		res := admin.do(http.MethodGet, "/api/v1/admin/stats/shortages?period=custom&from="+day(150)+"&to="+day(150)+query, nil)
		expect(t, res, http.StatusOK, "")
		if ct := res.Header().Get("Content-Type"); ct != "application/geo+json" {
			t.Fatalf("content type = %q", ct)
		}
		var out shortageResp
		res.decode(t, &out)
		return out
	}
	cells := func(m shortageResp) map[string]bool {
		out := map[string]bool{}
		for _, f := range m.Features {
			out[f.ID] = f.Properties.Shortage
		}
		return out
	}
	check := func(name string, m shortageResp, masked int, want map[h3.Cell]bool) {
		t.Helper()
		got := cells(m)
		if len(got) != len(want) || m.MaskedCells != masked || m.K != 5 {
			t.Fatalf("%s: cells %v (masked %d), want %d cells (masked %d)", name, got, m.MaskedCells, len(want), masked)
		}
		for c, shortage := range want {
			if sh, ok := got[c.String()]; !ok || sh != shortage {
				t.Fatalf("%s: cell %s = %v (present %v), want shortage %v", name, c, sh, ok, shortage)
			}
		}
	}
	all := get("")
	check("all products", all, 1, map[h3.Cell]bool{p: true, q: false, s: true, tc: true})
	check("product A", get(fmt.Sprintf("&productId=%d", gasA)), 2, map[h3.Cell]bool{p: true, q: false})
	check("product B", get(fmt.Sprintf("&productId=%d", gasB)), 1, map[h3.Cell]bool{s: true})
	check("only shortages", get("&onlyShortages=true"), 1, map[h3.Cell]bool{p: true, s: true, tc: true})

	// Géométrie : hexagone fermé, positions [lng, lat].
	for _, f := range all.Features {
		if f.ID != p.String() {
			continue
		}
		ring := f.Geometry.Coordinates[0]
		if f.Geometry.Type != "Polygon" || len(ring) != 7 || ring[0] != ring[6] || ring[0][0] < 1 || ring[0][0] > 2 || ring[0][1] < 7.8 || ring[0][1] > 8.2 {
			t.Fatalf("cell geometry = %+v", f.Geometry)
		}
		if f.Properties.Searches != 10 || f.Properties.EmptySearches != 5 || !near(f.Properties.EmptyRate, 0.5) {
			t.Fatalf("cell properties = %+v", f.Properties)
		}
	}

	// Période de 24 h : lue heure par heure.
	u := cell(11.5, 3.0)
	recordStats(t, time.Now(), u, gasA, 7, 1)
	flushStats(t)
	res := admin.do(http.MethodGet, fmt.Sprintf("/api/v1/admin/stats/shortages?period=24h&productId=%d", gasA), nil)
	expect(t, res, http.StatusOK, "")
	var last shortageResp
	res.decode(t, &last)
	if sh, ok := cells(last)[u.String()]; !ok || sh {
		t.Fatalf("24 h map: cell U present %v, shortage %v", ok, sh)
	}
	expect(t, admin.do(http.MethodGet, "/api/v1/admin/stats/shortages?productId=abc", nil), http.StatusBadRequest, "request.invalid_parameter")
}
