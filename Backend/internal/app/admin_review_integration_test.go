//go:build integration

package app_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"gostation/backend/internal/report"
)

type adminStationResp struct {
	ID       string `json:"id"`
	Reported bool   `json:"reported"`
	Excluded bool   `json:"excluded"`
}

type countersResp struct {
	PendingStations int `json:"pendingStations"`
	OpenReports     int `json:"openReports"`
	OpenAlerts      int `json:"openAlerts"`
	LocationReviews int `json:"locationReviews"`
}

func counters(t *testing.T, admin *client) countersResp {
	t.Helper()
	var c countersResp
	r := admin.do(http.MethodGet, "/api/v1/admin/counters", nil)
	expect(t, r, http.StatusOK, "")
	if r.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("counters Cache-Control = %q", r.Header().Get("Cache-Control"))
	}
	r.decode(t, &c)
	return c
}

// Files d'attente de l'admin : compteurs des badges, filtre « exclue » des stations, filtre par
// motif des signalements, validation stricte des paramètres.
func TestAdminCountersAndQueueFilters(t *testing.T) {
	admin := adminClient(t)
	before := counters(t, admin)

	// Dossier en attente (email vérifié) et épingle posée à 800 m de l'appareil du gérant.
	pendingManager(t)
	m, _ := approvedManager(t, admin)
	at := offset(bohicon, 63000)
	dev := move(at, 800, 0)
	expect(t, pin(t, m, at, &[3]float64{dev[0], dev[1], 15}), http.StatusOK, "")
	if c := counters(t, admin); c.PendingStations != before.PendingStations+1 || c.LocationReviews != before.LocationReviews+1 {
		t.Fatalf("counters = %+v, before %+v: want +1 pending, +1 location review", c, before)
	}

	// 5 signalements « rupture » : badge à 3, exclusion et alerte à 5.
	prod := newProduct(t)
	stationAt := offset(bohicon, 66000)
	_, stationID := readyStation(t, admin, stationAt, map[int16]int{prod: 9})
	var detail struct {
		IFU string `json:"ifu"`
	}
	admin.do(http.MethodGet, "/api/v1/admin/stations/"+stationID, nil).decode(t, &detail)
	excludedList := func() []adminStationResp {
		var page struct {
			Items []adminStationResp `json:"items"`
		}
		r := admin.do(http.MethodGet, "/api/v1/admin/stations?status=all&excluded=true&q="+detail.IFU, nil)
		expect(t, r, http.StatusOK, "")
		r.decode(t, &page)
		return page.Items
	}
	near := move(stationAt, 300, 0)
	body := reportBody(report.ReasonOutOfStock, prod, &near, "")
	mid := counters(t, admin)
	for i := range 5 {
		c, _, _ := verifiedUser(t)
		expect(t, postReport(c, stationID, body), http.StatusCreated, "")
		if i == 2 && len(excludedList()) != 0 {
			t.Fatal("station listed as excluded with 3 reports (badge only)")
		}
	}
	if items := excludedList(); len(items) != 1 || items[0].ID != stationID || !items[0].Excluded || !items[0].Reported {
		t.Fatalf("excluded stations = %+v, want %s", items, stationID)
	}
	if c := counters(t, admin); c.OpenReports != mid.OpenReports+5 || c.OpenAlerts != mid.OpenAlerts+1 {
		t.Fatalf("counters = %+v, before %+v: want +5 open reports, +1 alert", c, mid)
	}

	// Filtre par motif.
	count := func(reason string) int {
		var page struct {
			Items []struct {
				Reason string `json:"reason"`
			} `json:"items"`
		}
		r := admin.do(http.MethodGet, "/api/v1/admin/reports?stationId="+stationID+"&reason="+reason, nil)
		expect(t, r, http.StatusOK, "")
		r.decode(t, &page)
		for _, it := range page.Items {
			if it.Reason != reason {
				t.Fatalf("reason filter %s returned %s", reason, it.Reason)
			}
		}
		return len(page.Items)
	}
	if n := count(report.ReasonOutOfStock); n != 5 {
		t.Fatalf("out_of_stock reports = %d, want 5", n)
	}
	if n := count(report.ReasonStationClosed); n != 0 {
		t.Fatalf("station_closed reports = %d, want 0", n)
	}
	expect(t, admin.do(http.MethodGet, "/api/v1/admin/reports?reason=bogus", nil), http.StatusUnprocessableEntity, "request.validation_failed")

	// Validation stricte : paramètre inconnu refusé.
	for _, path := range []string{"/api/v1/admin/reports?sort=asc", "/api/v1/admin/alerts?station=1", "/api/v1/admin/counters?x=1"} {
		expect(t, admin.do(http.MethodGet, path, nil), http.StatusBadRequest, "request.invalid_parameter")
	}
}

// La fiche admin d'une station montre ses horaires (fermetures à venir comprises) et ses stocks,
// avec leur fraîcheur, quel que soit son statut ; l'admin ne fait que les lire.
func TestAdminStationDetailShowsHoursAndStocks(t *testing.T) {
	admin := adminClient(t)
	gas := newProduct(t)
	_, stationID := readyStation(t, admin, offset(bohicon, 41000), map[int16]int{gas: 7})
	var d struct {
		OpeningHours struct {
			IsOpenNow bool `json:"isOpenNow"`
			Days      []struct {
				Is24h bool `json:"is24h"`
			} `json:"days"`
			Closures []json.RawMessage `json:"closures"`
		} `json:"openingHours"`
		Stocks []struct {
			ProductID int16  `json:"productId"`
			Quantity  int    `json:"quantity"`
			Freshness string `json:"freshness"`
		} `json:"stocks"`
	}
	r := admin.do(http.MethodGet, "/api/v1/admin/stations/"+stationID, nil)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &d)
	if !d.OpeningHours.IsOpenNow || len(d.OpeningHours.Days) != 7 || !d.OpeningHours.Days[0].Is24h || d.OpeningHours.Closures == nil {
		t.Fatalf("opening hours = %+v, want 24/7", d.OpeningHours)
	}
	if len(d.Stocks) != 1 || d.Stocks[0].ProductID != gas || d.Stocks[0].Quantity != 7 || d.Stocks[0].Freshness != "fresh" {
		t.Fatalf("stocks = %+v, want %d × 7, fresh", d.Stocks, gas)
	}

	// Dossier en attente : pas encore d'horaires ni de stocks, mais des listes (jamais null).
	_, _, pending := pendingManager(t)
	r = admin.do(http.MethodGet, "/api/v1/admin/stations/"+pending, nil)
	expect(t, r, http.StatusOK, "")
	if body := r.Body.String(); !strings.Contains(body, `"stocks":[]`) || !strings.Contains(body, `"days":[]`) {
		t.Fatalf("pending station detail: %s", body)
	}
}
