//go:build integration

package app_test

import (
	"bytes"
	"fmt"
	"math/rand/v2"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/auth"
	"gostation/backend/internal/searchcache"
	"gostation/backend/internal/station"
)

// Points de test (lat, lng).
var (
	cotonouDantokpa = [2]float64{6.3703, 2.4253}
	lome            = [2]float64{6.1375, 1.2123} // Togo
	lagos           = [2]float64{6.5244, 3.3792} // Nigeria
)

func randomIFU() string { return fmt.Sprintf("32%011d", rand.Int64N(100_000_000_000)) }

// adminClient ouvre une session admin web (2FA comprise) et renvoie un client cookie + CSRF.
func adminClient(t *testing.T) *client {
	t.Helper()
	email := uniqueEmail("admin")
	if _, err := it.svc.Auth.CreateAdmin(t.Context(), email, "Ada", "Admin", password); err != nil {
		t.Fatal(err)
	}
	c := newClient(t)
	ch := adminLogin(t, c, email)
	r := c.do(http.MethodPost, "/api/v1/auth/admin/2fa", map[string]string{"mfaToken": ch.MFAToken, "code": totp(t, ch.Setup.Secret, time.Now())})
	expect(t, r, http.StatusOK, "")
	var sess adminSession
	r.decode(t, &sess)
	c.csrf = sess.CSRFToken
	return c
}

type stationResp struct {
	ID           string  `json:"id"`
	Status       string  `json:"status"`
	StatusReason *string `json:"statusReason"`
	Version      int     `json:"version"`
	City         *string `json:"city"`
	Location     *struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	} `json:"location"`
	LocationFlag *struct {
		DistanceM int `json:"distanceM"`
	} `json:"locationFlag"`
	PendingMove *struct {
		ID        string `json:"id"`
		DistanceM int    `json:"distanceM"`
	} `json:"pendingMove"`
}

// pendingManager inscrit un gérant et vérifie son email (dossier visible chez l'admin).
func pendingManager(t *testing.T) (*client, string, string) {
	t.Helper()
	c := newClient(t)
	email := uniqueEmail("gerant")
	fields := managerFields(email)
	fields["ifu"] = randomIFU()
	r := c.multipart("/api/v1/auth/register/manager", fields, "ifu.pdf", []byte("%PDF-1.7 attestation"))
	expect(t, r, http.StatusCreated, "")
	var s session
	r.decode(t, &s)
	c.bearer = s.AccessToken
	code := latestCode(t, email, "Confirmez votre adresse")
	expect(t, c.do(http.MethodPost, "/api/v1/auth/verify-email", map[string]string{"email": email, "code": code}), http.StatusNoContent, "")
	return c, email, s.User.Station.ID
}

// approvedManager renvoie un gérant dont la station vient d'être approuvée par l'admin.
func approvedManager(t *testing.T, admin *client) (*client, string) {
	t.Helper()
	m, _, stationID := pendingManager(t)
	r := admin.do(http.MethodGet, "/api/v1/admin/stations/"+stationID, nil)
	expect(t, r, http.StatusOK, "")
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/stations/"+stationID+"/approve", r.Header().Get("ETag"), nil), http.StatusOK, "")
	return m, stationID
}

// etag lit la version courante d'une ressource gérant.
func etag(t *testing.T, c *client, path string) string {
	t.Helper()
	r := c.do(http.MethodGet, path, nil)
	expect(t, r, http.StatusOK, "")
	tag := r.Header().Get("ETag")
	if tag == "" {
		t.Fatalf("GET %s without ETag", path)
	}
	return tag
}

func pin(t *testing.T, c *client, p [2]float64, device *[3]float64) response {
	t.Helper()
	body := map[string]any{"lat": p[0], "lng": p[1], "confirmStationLocation": true}
	if device != nil {
		body["device"] = map[string]float64{"lat": device[0], "lng": device[1], "accuracyM": device[2]}
	}
	return c.doIf(http.MethodPut, "/api/v1/manager/station/location", etag(t, c, "/api/v1/manager/station"), body)
}

func productID(t *testing.T, code string) int16 {
	t.Helper()
	rows, err := it.svc.Store.ListActiveProducts(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range rows {
		if p.Code == code {
			return p.ID
		}
	}
	t.Fatalf("product %s not found", code)
	return 0
}

// offset déplace un point d'environ dNorth mètres vers le nord.
func offset(p [2]float64, dNorth float64) [2]float64 {
	return [2]float64{p[0] + dNorth/111_320, p[1]}
}

func TestDatesAreUTC(t *testing.T) {
	c := newClient(t)
	r := c.do(http.MethodPost, "/api/v1/auth/register", map[string]string{
		"firstName": "Afi", "lastName": "Dossou", "email": uniqueEmail("utc"), "password": password, "privacyPolicyVersion": "1.0",
	})
	expect(t, r, http.StatusCreated, "")
	if !strings.Contains(r.Body.String(), `Z"`) || strings.Contains(r.Body.String(), `+01:00"`) {
		t.Fatalf("dates must be RFC 3339 UTC: %s", r.Body.String())
	}
}

func TestManagerStationJourney(t *testing.T) {
	admin := adminClient(t)
	m, email, stationID := pendingManager(t)

	// Liste admin : le dossier vérifié apparaît parmi les pending.
	var page struct {
		Items []struct {
			ID                   string `json:"id"`
			ManagerEmailVerified bool   `json:"managerEmailVerified"`
		} `json:"items"`
	}
	admin.do(http.MethodGet, "/api/v1/admin/stations?status=pending&limit=100", nil).decode(t, &page)
	found := false
	for _, it := range page.Items {
		found = found || (it.ID == stationID && it.ManagerEmailVerified)
	}
	if !found {
		t.Fatal("verified pending station missing from the admin list")
	}

	// Approbation, avec verrouillage optimiste.
	detail := admin.do(http.MethodGet, "/api/v1/admin/stations/"+stationID, nil)
	expect(t, detail, http.StatusOK, "")
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/stations/"+stationID+"/approve", "", nil), http.StatusPreconditionRequired, apperr.CodePrecondition)
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/stations/"+stationID+"/approve", `"v999"`, nil), http.StatusPreconditionFailed, apperr.CodeVersionConflict)
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/stations/"+stationID+"/approve", detail.Header().Get("ETag"), nil), http.StatusOK, "")
	if _, err := it.mailpit.WaitFor(t.Context(), email, "Votre station est validée"); err != nil {
		t.Fatal(err)
	}

	// Épinglage (appareil à proximité : pas de signalement), cellule H3 calculée.
	device := [3]float64{6.3705, 2.4255, 12}
	r := pin(t, m, cotonouDantokpa, &device)
	expect(t, r, http.StatusOK, "")
	var loc struct {
		Outcome string      `json:"outcome"`
		Flagged bool        `json:"flagged"`
		Station stationResp `json:"station"`
	}
	r.decode(t, &loc)
	if loc.Outcome != station.OutcomeSet || loc.Flagged || loc.Station.Location == nil {
		t.Fatalf("pin = %+v", loc)
	}
	var h3cell *int64
	if err := it.pool.QueryRow(t.Context(), `SELECT h3_r8 FROM stations WHERE id = $1`, stationID).Scan(&h3cell); err != nil || h3cell == nil {
		t.Fatalf("h3_r8 not computed: %v %v", h3cell, err)
	}

	// Horaires : deux plages le lundi, une plage de nuit le vendredi, 24 h/24 le dimanche.
	hours := map[string]any{"days": []map[string]any{
		{"weekday": 1, "ranges": []map[string]string{{"opens": "06:00", "closes": "12:00"}, {"opens": "14:00", "closes": "22:00"}}},
		{"weekday": 5, "ranges": []map[string]string{{"opens": "18:00", "closes": "02:00"}}},
		{"weekday": 7, "is24h": true},
	}}
	r = m.doIf(http.MethodPut, "/api/v1/manager/station/opening-hours", etag(t, m, "/api/v1/manager/station/opening-hours"), hours)
	expect(t, r, http.StatusOK, "")
	var hv struct {
		Timezone string `json:"timezone"`
		Days     []struct {
			Weekday int  `json:"weekday"`
			Is24h   bool `json:"is24h"`
			Ranges  []struct {
				Opens  string `json:"opens"`
				Closes string `json:"closes"`
			} `json:"ranges"`
		} `json:"days"`
		Closures []struct {
			Date string `json:"date"`
		} `json:"closures"`
	}
	r.decode(t, &hv)
	if hv.Timezone != "Africa/Porto-Novo" || len(hv.Days) != 3 || len(hv.Days[0].Ranges) != 2 || !hv.Days[2].Is24h || hv.Days[1].Ranges[0].Closes != "02:00" {
		t.Fatalf("hours = %+v", hv)
	}

	// Fermeture exceptionnelle (demain), doublon refusé.
	tomorrow := time.Now().In(it.cfg.Timezone).AddDate(0, 0, 1).Format(time.DateOnly)
	expect(t, m.doIf(http.MethodPost, "/api/v1/manager/station/closures", etag(t, m, "/api/v1/manager/station"), map[string]string{"date": tomorrow, "reason": "Inventaire"}), http.StatusCreated, "")
	expect(t, m.doIf(http.MethodPost, "/api/v1/manager/station/closures", etag(t, m, "/api/v1/manager/station"), map[string]string{"date": tomorrow}), http.StatusConflict, station.CodeClosureExists)
	m.do(http.MethodGet, "/api/v1/manager/station/opening-hours", nil).decode(t, &hv)
	if len(hv.Closures) != 1 || hv.Closures[0].Date != tomorrow {
		t.Fatalf("closures = %+v", hv.Closures)
	}

	// Produits vendus, puis stocks.
	gas, petrol := productID(t, "lpg_10kg"), productID(t, "petrol")
	expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/products", etag(t, m, "/api/v1/manager/station/products"), map[string]any{"productIds": []int16{gas, petrol}}), http.StatusOK, "")
	var stocks struct {
		Items []struct {
			ProductID       int16     `json:"productId"`
			Quantity        int       `json:"quantity"`
			MaxQuantity     int       `json:"maxQuantity"`
			UpdatedAt       time.Time `json:"updatedAt"`
			LastConfirmedAt time.Time `json:"lastConfirmedAt"`
			Freshness       string    `json:"freshness"`
		} `json:"items"`
	}
	m.do(http.MethodGet, "/api/v1/manager/station/stocks", nil).decode(t, &stocks)
	if len(stocks.Items) != 2 || stocks.Items[0].Quantity != 0 || stocks.Items[0].MaxQuantity != 10_000 || stocks.Items[1].MaxQuantity != 200_000 {
		t.Fatalf("initial stocks = %+v", stocks.Items)
	}

	update := func(gasQty, petrolQty int) response {
		return m.doIf(http.MethodPut, "/api/v1/manager/station/stocks", etag(t, m, "/api/v1/manager/station/stocks"),
			map[string]any{"items": []map[string]int{{"productId": int(gas), "quantity": gasQty}, {"productId": int(petrol), "quantity": petrolQty}}})
	}
	expect(t, update(12, 5000), http.StatusOK, "")
	expect(t, update(12, 4800), http.StatusOK, "") // seul l'essence change
	var history int
	if err := it.pool.QueryRow(t.Context(), `SELECT count(*) FROM stock_history WHERE station_id = $1`, stationID).Scan(&history); err != nil || history != 3 {
		t.Fatalf("stock_history rows = %d (%v), want 3", history, err)
	}

	// « Rien n'a changé » : last_confirmed_at avance, updated_at et quantités restent.
	m.do(http.MethodGet, "/api/v1/manager/station/stocks", nil).decode(t, &stocks)
	before := stocks.Items[0]
	time.Sleep(20 * time.Millisecond)
	r = m.doIf(http.MethodPost, "/api/v1/manager/station/stocks/confirm", etag(t, m, "/api/v1/manager/station/stocks"), nil)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &stocks)
	after := stocks.Items[0]
	if !after.LastConfirmedAt.After(before.LastConfirmedAt) || !after.UpdatedAt.Equal(before.UpdatedAt) || after.Quantity != 12 || after.Freshness != station.FreshnessFresh {
		t.Fatalf("confirm: before %+v after %+v", before, after)
	}

	// Écriture concurrente : un ETag périmé est refusé.
	stale := etag(t, m, "/api/v1/manager/station/stocks")
	expect(t, update(10, 4800), http.StatusOK, "")
	expect(t, m.doIf(http.MethodPost, "/api/v1/manager/station/stocks/confirm", stale, nil), http.StatusPreconditionFailed, apperr.CodeVersionConflict)
	expect(t, m.doIf(http.MethodPost, "/api/v1/manager/station/stocks/confirm", "", nil), http.StatusPreconditionRequired, apperr.CodePrecondition)

	if !contains(auditActions(t, "station", stationID), "admin.station_approved", "manager.location_set", "manager.hours_updated",
		"manager.closure_added", "manager.products_updated") {
		t.Errorf("station audit = %v", auditActions(t, "station", stationID))
	}
}

func TestPinOutsideBenin(t *testing.T) {
	m, _ := approvedManager(t, adminClient(t))
	for name, p := range map[string][2]float64{"Lomé": lome, "Lagos": lagos} {
		expect(t, pin(t, m, p, nil), http.StatusUnprocessableEntity, station.CodeOutsideCountry)
		_ = name
	}
	expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/location", etag(t, m, "/api/v1/manager/station"),
		map[string]any{"lat": cotonouDantokpa[0], "lng": cotonouDantokpa[1]}), http.StatusUnprocessableEntity, apperr.CodeValidation)

	// Marge de 2 km : depuis le point de la frontière le plus proche de Lomé, 5 km vers Lomé est
	// refusé, 1 km est accepté.
	point := func(meters float64) [2]float64 {
		var lat, lng float64
		err := it.pool.QueryRow(t.Context(), `
			WITH lome AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS g),
			     edge AS (SELECT ST_ClosestPoint(ST_Boundary(b.boundary::geometry), lome.g) AS g FROM country_boundaries b, lome WHERE b.code = 'BEN')
			SELECT ST_Y(p::geometry), ST_X(p::geometry)
			FROM (SELECT ST_Project(edge.g::geography, $3::float8, ST_Azimuth(edge.g, lome.g)) AS p FROM edge, lome) x`,
			lome[1], lome[0], meters).Scan(&lat, &lng)
		if err != nil {
			t.Fatal(err)
		}
		return [2]float64{lat, lng}
	}
	expect(t, pin(t, m, point(5000), nil), http.StatusUnprocessableEntity, station.CodeOutsideCountry)
	expect(t, pin(t, m, point(1000), nil), http.StatusOK, "")
}

func TestLocationMovesAndFlags(t *testing.T) {
	admin := adminClient(t)
	m, stationID := approvedManager(t, admin)

	// Premier épinglage à 2 km de l'appareil : appliqué mais signalé.
	far := [3]float64{cotonouDantokpa[0] + 0.018, cotonouDantokpa[1], 15}
	r := pin(t, m, cotonouDantokpa, &far)
	expect(t, r, http.StatusOK, "")
	var loc struct {
		Outcome string      `json:"outcome"`
		Flagged bool        `json:"flagged"`
		Station stationResp `json:"station"`
	}
	r.decode(t, &loc)
	if !loc.Flagged || loc.Station.LocationFlag == nil || loc.Station.LocationFlag.DistanceM < 1900 {
		t.Fatalf("far pin not flagged: %+v", loc)
	}
	var review struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	admin.do(http.MethodGet, "/api/v1/admin/stations?status=approved&needsReview=true&limit=100", nil).decode(t, &review)
	if !strings.Contains(mustJSON(t, review), stationID) {
		t.Fatal("flagged station missing from the needsReview list")
	}
	d := admin.do(http.MethodGet, "/api/v1/admin/stations/"+stationID, nil)
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/stations/"+stationID+"/location-flag/dismiss", d.Header().Get("ETag"), nil), http.StatusOK, "")

	// Correction de 100 m : appliquée.
	near := offset(cotonouDantokpa, 100)
	r = pin(t, m, near, nil)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &loc)
	if loc.Outcome != station.OutcomeCorrected || loc.Station.Location.Lat != near[0] || loc.Station.LocationFlag != nil {
		t.Fatalf("correction = %+v", loc)
	}

	// Déplacement de 1 km : en attente, l'ancienne position reste active.
	moved := offset(near, 1000)
	r = pin(t, m, moved, nil)
	expect(t, r, http.StatusAccepted, "")
	r.decode(t, &loc)
	if loc.Outcome != station.OutcomeMoveRequested || loc.Station.Location.Lat != near[0] || loc.Station.PendingMove == nil || loc.Station.PendingMove.DistanceM < 950 {
		t.Fatalf("move request = %+v", loc)
	}
	var adminView stationResp
	d = admin.do(http.MethodGet, "/api/v1/admin/stations/"+stationID, nil)
	d.decode(t, &adminView)
	expect(t, admin.doIf(http.MethodPost, fmt.Sprintf("/api/v1/admin/stations/%s/location-requests/%s/approve", stationID, adminView.PendingMove.ID), d.Header().Get("ETag"), nil), http.StatusOK, "")
	var mine stationResp
	m.do(http.MethodGet, "/api/v1/manager/station", nil).decode(t, &mine)
	if mine.Location.Lat != moved[0] || mine.PendingMove != nil {
		t.Fatalf("approved move not applied: %+v", mine)
	}

	// Nouvelle demande, refusée par l'admin (motif obligatoire) : position inchangée.
	expect(t, pin(t, m, offset(moved, 2000), nil), http.StatusAccepted, "")
	d = admin.do(http.MethodGet, "/api/v1/admin/stations/"+stationID, nil)
	d.decode(t, &adminView)
	rejectPath := fmt.Sprintf("/api/v1/admin/stations/%s/location-requests/%s/reject", stationID, adminView.PendingMove.ID)
	expect(t, admin.doIf(http.MethodPost, rejectPath, d.Header().Get("ETag"), map[string]string{"reason": ""}), http.StatusUnprocessableEntity, apperr.CodeValidation)
	expect(t, admin.doIf(http.MethodPost, rejectPath, d.Header().Get("ETag"), map[string]string{"reason": "Adresse incohérente"}), http.StatusOK, "")
	m.do(http.MethodGet, "/api/v1/manager/station", nil).decode(t, &mine)
	if mine.Location.Lat != moved[0] || mine.PendingMove != nil {
		t.Fatalf("rejected move changed the station: %+v", mine)
	}
}

func TestIFUChangeSendsBackToPending(t *testing.T) {
	m, stationID := approvedManager(t, adminClient(t))
	r := m.doIf(http.MethodPatch, "/api/v1/manager/station", etag(t, m, "/api/v1/manager/station"), map[string]string{"name": "Station Akpakpa Nord", "city": ""})
	expect(t, r, http.StatusOK, "")
	var st stationResp
	r.decode(t, &st)
	if st.Status != station.StatusApproved || st.City != nil {
		t.Fatalf("free fields must not change the status: %+v", st)
	}
	gens := generations(t, 1)
	r = m.doIf(http.MethodPatch, "/api/v1/manager/station", etag(t, m, "/api/v1/manager/station"), map[string]string{"ifu": randomIFU()})
	expect(t, r, http.StatusOK, "")
	r.decode(t, &st)
	if st.Status != station.StatusPending {
		t.Fatalf("IFU change: status %s, want pending", st.Status)
	}
	if generations(t, 1).All <= gens.All {
		t.Error("leaving the search must invalidate the cache")
	}
	expect(t, m.do(http.MethodGet, "/api/v1/manager/station", nil), http.StatusForbidden, auth.CodeStationNotApproved)
	expect(t, m.doIf(http.MethodPatch, "/api/v1/manager/station", `"v1"`, map[string]string{"rccm": "!!"}), http.StatusForbidden, auth.CodeStationNotApproved)
	_ = stationID
}

func multipartIf(c *client, path, etag string, file []byte) response {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile("document", "ifu.pdf")
	_, _ = fw.Write(file)
	_ = w.Close()
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("If-Match", etag)
	return c.send(req)
}

func TestRejectAndResubmit(t *testing.T) {
	admin := adminClient(t)
	m, email, stationID := pendingManager(t)
	d := admin.do(http.MethodGet, "/api/v1/admin/stations/"+stationID, nil)
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/stations/"+stationID+"/reject", d.Header().Get("ETag"), map[string]string{"reason": " "}), http.StatusUnprocessableEntity, apperr.CodeValidation)
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/stations/"+stationID+"/reject", d.Header().Get("ETag"), map[string]string{"reason": "Justificatif illisible"}), http.StatusOK, "")
	msg, err := it.mailpit.WaitFor(t.Context(), email, "doit être corrigée")
	if err != nil || !strings.Contains(msg.Text, "Justificatif illisible") || !strings.Contains(msg.Text, "[Refusée]") {
		t.Fatalf("rejection email = %+v, %v", msg.Text, err)
	}

	// Exception « rejected » : consultation et correction possibles, configuration non.
	var st stationResp
	m.do(http.MethodGet, "/api/v1/manager/station", nil).decode(t, &st)
	if st.Status != station.StatusRejected || st.StatusReason == nil || *st.StatusReason != "Justificatif illisible" {
		t.Fatalf("rejected station = %+v", st)
	}
	r := m.doIf(http.MethodPatch, "/api/v1/manager/station", etag(t, m, "/api/v1/manager/station"), map[string]string{"ifu": randomIFU()})
	expect(t, r, http.StatusOK, "")
	r.decode(t, &st)
	if st.Status != station.StatusRejected {
		t.Fatalf("correcting a rejected station must not resubmit it: %s", st.Status)
	}
	expect(t, pin(t, m, cotonouDantokpa, nil), http.StatusForbidden, auth.CodeStationNotApproved)

	// Renvoi du justificatif : retour en pending, nouveau document chez l'admin.
	newDoc := []byte("%PDF-1.7 attestation lisible")
	r = multipartIf(m, "/api/v1/manager/station/resubmission", etag(t, m, "/api/v1/manager/station"), newDoc)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &st)
	if st.Status != station.StatusPending || st.StatusReason != nil {
		t.Fatalf("resubmitted station = %+v", st)
	}
	doc := admin.do(http.MethodGet, "/api/v1/admin/stations/"+stationID+"/document", nil)
	if !bytes.Equal(doc.Body.Bytes(), newDoc) {
		t.Fatal("admin must see the resubmitted document")
	}
	// Plus de renvoi possible une fois en pending.
	expect(t, multipartIf(m, "/api/v1/manager/station/resubmission", `"v1"`, newDoc), http.StatusForbidden, auth.CodeStationNotApproved)
}

func TestStockValidationAndCaps(t *testing.T) {
	m, _ := approvedManager(t, adminClient(t))
	expect(t, m.doIf(http.MethodPost, "/api/v1/manager/station/stocks/confirm", etag(t, m, "/api/v1/manager/station/stocks"), nil), http.StatusUnprocessableEntity, station.CodeNoProductsSold)

	gas, petrol, diesel := productID(t, "lpg_10kg"), productID(t, "petrol"), productID(t, "diesel")
	expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/products", etag(t, m, "/api/v1/manager/station/products"), map[string]any{"productIds": []int16{gas, petrol, 999}}),
		http.StatusUnprocessableEntity, apperr.CodeValidation)
	expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/products", etag(t, m, "/api/v1/manager/station/products"), map[string]any{"productIds": []int16{gas, petrol}}), http.StatusOK, "")

	tests := []struct {
		name  string
		items []map[string]int
		code  string
	}{
		{"cylinders above cap", []map[string]int{{"productId": int(gas), "quantity": 10_001}, {"productId": int(petrol), "quantity": 0}}, "above_cap"},
		{"liters above cap", []map[string]int{{"productId": int(gas), "quantity": 0}, {"productId": int(petrol), "quantity": 200_001}}, "above_cap"},
		{"negative", []map[string]int{{"productId": int(gas), "quantity": -1}, {"productId": int(petrol), "quantity": 0}}, "negative"},
		{"product not sold", []map[string]int{{"productId": int(gas), "quantity": 1}, {"productId": int(petrol), "quantity": 1}, {"productId": int(diesel), "quantity": 1}}, "not_sold"},
		{"duplicate", []map[string]int{{"productId": int(gas), "quantity": 1}, {"productId": int(gas), "quantity": 2}, {"productId": int(petrol), "quantity": 1}}, "duplicate"},
		{"missing sold product", []map[string]int{{"productId": int(gas), "quantity": 1}}, "missing_product"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := m.doIf(http.MethodPut, "/api/v1/manager/station/stocks", etag(t, m, "/api/v1/manager/station/stocks"), map[string]any{"items": tt.items})
			expect(t, r, http.StatusUnprocessableEntity, apperr.CodeValidation)
			if !strings.Contains(r.Body.String(), `"code":"`+tt.code+`"`) {
				t.Errorf("body %s lacks field code %s", r.Body.String(), tt.code)
			}
		})
	}
	ok := m.doIf(http.MethodPut, "/api/v1/manager/station/stocks", etag(t, m, "/api/v1/manager/station/stocks"),
		map[string]any{"items": []map[string]int{{"productId": int(gas), "quantity": 10_000}, {"productId": int(petrol), "quantity": 200_000}}})
	expect(t, ok, http.StatusOK, "")
}

func TestSuspendAndUnsuspend(t *testing.T) {
	admin := adminClient(t)
	m, stationID := approvedManager(t, admin)
	path := "/api/v1/admin/stations/" + stationID

	approveAgain := admin.doIf(http.MethodPost, path+"/approve", admin.do(http.MethodGet, path, nil).Header().Get("ETag"), nil)
	expect(t, approveAgain, http.StatusConflict, station.CodeInvalidTransition)

	expect(t, admin.doIf(http.MethodPost, path+"/suspend", admin.do(http.MethodGet, path, nil).Header().Get("ETag"), map[string]string{}), http.StatusUnprocessableEntity, apperr.CodeValidation)
	expect(t, admin.doIf(http.MethodPost, path+"/suspend", admin.do(http.MethodGet, path, nil).Header().Get("ETag"), map[string]string{"reason": "Prix affichés trompeurs"}), http.StatusOK, "")
	r := m.do(http.MethodGet, "/api/v1/manager/station/stocks", nil)
	expect(t, r, http.StatusForbidden, auth.CodeStationNotApproved)
	if !strings.Contains(r.Body.String(), `"stationStatus":"suspended"`) {
		t.Errorf("problem must carry the suspended status: %s", r.Body.String())
	}
	expect(t, admin.doIf(http.MethodPost, path+"/unsuspend", admin.do(http.MethodGet, path, nil).Header().Get("ETag"), map[string]string{"reason": "Situation régularisée"}), http.StatusOK, "")
	expect(t, m.do(http.MethodGet, "/api/v1/manager/station/stocks", nil), http.StatusOK, "")
	if !contains(auditActions(t, "station", stationID), "admin.station_suspended", "admin.station_unsuspended") {
		t.Errorf("suspension not audited: %v", auditActions(t, "station", stationID))
	}

	// Un gérant dont l'email n'est pas vérifié ne peut pas être approuvé.
	c := newClient(t)
	fields := managerFields(uniqueEmail("unverified"))
	reg := c.multipart("/api/v1/auth/register/manager", fields, "ifu.pdf", []byte("%PDF-1.7"))
	var s session
	reg.decode(t, &s)
	p := "/api/v1/admin/stations/" + s.User.Station.ID
	expect(t, admin.doIf(http.MethodPost, p+"/approve", admin.do(http.MethodGet, p, nil).Header().Get("ETag"), nil), http.StatusConflict, station.CodeManagerEmailUnverified)
}

func TestAdminListSearchAndPagination(t *testing.T) {
	admin := adminClient(t)
	prefix := fmt.Sprintf("Pagination-%d", rand.IntN(1_000_000))
	ifus := []string{}
	for i := range 3 {
		c := newClient(t)
		email := uniqueEmail("page")
		fields := managerFields(email)
		fields["stationName"] = fmt.Sprintf("%s %d", prefix, i)
		fields["ifu"] = randomIFU()
		ifus = append(ifus, fields["ifu"])
		expect(t, c.multipart("/api/v1/auth/register/manager", fields, "ifu.pdf", []byte("%PDF-1.7")), http.StatusCreated, "")
		code := latestCode(t, email, "Confirmez votre adresse")
		expect(t, c.do(http.MethodPost, "/api/v1/auth/verify-email", map[string]string{"email": email, "code": code}), http.StatusNoContent, "")
	}
	type page struct {
		Items []struct {
			Name string `json:"name"`
		} `json:"items"`
		NextCursor *string `json:"nextCursor"`
	}
	var names []string
	cursor := ""
	for range 5 {
		var p page
		admin.do(http.MethodGet, "/api/v1/admin/stations?status=pending&limit=1&q="+prefix+"&cursor="+cursor, nil).decode(t, &p)
		for _, it := range p.Items {
			names = append(names, it.Name)
		}
		if p.NextCursor == nil {
			break
		}
		cursor = *p.NextCursor
	}
	if strings.Join(names, ",") != fmt.Sprintf("%s 2,%s 1,%s 0", prefix, prefix, prefix) {
		t.Fatalf("paginated names = %v (newest first expected)", names)
	}
	var byIFU page
	admin.do(http.MethodGet, "/api/v1/admin/stations?status=pending&q="+ifus[1][:13], nil).decode(t, &byIFU)
	if len(byIFU.Items) != 1 || byIFU.Items[0].Name != prefix+" 1" {
		t.Fatalf("IFU search = %+v", byIFU.Items)
	}
	expect(t, admin.do(http.MethodGet, "/api/v1/admin/stations?status=bogus", nil), http.StatusUnprocessableEntity, apperr.CodeValidation)
	expect(t, admin.do(http.MethodGet, "/api/v1/admin/stations?cursor=not-a-cursor", nil), http.StatusBadRequest, apperr.CodeInvalidParameter)
}

func generations(t *testing.T, product int16) searchcache.Generations {
	t.Helper()
	g, err := searchcache.New(it.rdb).Current(t.Context(), product)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestCacheInvalidation(t *testing.T) {
	admin := adminClient(t)
	m, stationID := approvedManager(t, admin)
	gas, petrol, diesel := productID(t, "lpg_10kg"), productID(t, "petrol"), productID(t, "diesel")

	steps := []struct {
		name string
		do   func()
		all  bool    // la génération globale doit augmenter
		prod []int16 // générations produit qui doivent augmenter
	}{
		{"location", func() { expect(t, pin(t, m, cotonouDantokpa, nil), http.StatusOK, "") }, true, nil},
		{"opening hours", func() {
			expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/opening-hours", etag(t, m, "/api/v1/manager/station"), map[string]any{"allWeek24h": true}), http.StatusOK, "")
		}, true, nil},
		{"closure", func() {
			day := time.Now().In(it.cfg.Timezone).AddDate(0, 0, 3).Format(time.DateOnly)
			expect(t, m.doIf(http.MethodPost, "/api/v1/manager/station/closures", etag(t, m, "/api/v1/manager/station"), map[string]string{"date": day}), http.StatusCreated, "")
		}, true, nil},
		{"products sold", func() {
			expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/products", etag(t, m, "/api/v1/manager/station"), map[string]any{"productIds": []int16{gas, petrol}}), http.StatusOK, "")
		}, true, nil},
		{"stock update", func() {
			expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/stocks", etag(t, m, "/api/v1/manager/station"),
				map[string]any{"items": []map[string]int{{"productId": int(gas), "quantity": 3}, {"productId": int(petrol), "quantity": 0}}}), http.StatusOK, "")
		}, false, []int16{gas, petrol}},
		{"stock confirm", func() {
			expect(t, m.doIf(http.MethodPost, "/api/v1/manager/station/stocks/confirm", etag(t, m, "/api/v1/manager/station"), nil), http.StatusOK, "")
		}, false, []int16{gas, petrol}},
		{"status change", func() {
			p := "/api/v1/admin/stations/" + stationID
			expect(t, admin.doIf(http.MethodPost, p+"/suspend", admin.do(http.MethodGet, p, nil).Header().Get("ETag"), map[string]string{"reason": "Contrôle"}), http.StatusOK, "")
		}, true, nil},
	}
	for _, s := range steps {
		beforeAll := generations(t, gas).All
		before := map[int16]int64{}
		for _, id := range []int16{gas, petrol, diesel} {
			before[id] = generations(t, id).Product
		}
		s.do()
		if got := generations(t, gas).All; (got > beforeAll) != s.all {
			t.Errorf("%s: global generation %d → %d, want increment=%v", s.name, beforeAll, got, s.all)
		}
		for _, id := range []int16{gas, petrol, diesel} {
			bumped := generations(t, id).Product > before[id]
			want := false
			for _, p := range s.prod {
				want = want || p == id
			}
			if bumped != want {
				t.Errorf("%s: product %d generation bumped=%v, want %v", s.name, id, bumped, want)
			}
		}
	}
}
