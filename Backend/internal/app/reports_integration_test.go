//go:build integration

package app_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"gostation/backend/internal/auth"
	"gostation/backend/internal/report"
)

func reportBody(reason string, product int16, at *[2]float64, comment string) map[string]any {
	b := map[string]any{"reason": reason}
	if product != 0 {
		b["productId"] = product
	}
	if at != nil {
		b["position"] = map[string]float64{"lat": at[0], "lng": at[1]}
	}
	if comment != "" {
		b["comment"] = comment
	}
	return b
}

func postReport(c *client, stationID string, body map[string]any) response {
	return c.do(http.MethodPost, "/api/v1/stations/"+stationID+"/reports", body)
}

// searchFor renvoie le résultat de la station dans une recherche depuis p (nil si absente).
func searchFor(t *testing.T, p [2]float64, product int16, stationID string) map[string]any {
	t.Helper()
	c := newClient(t)
	r := c.get(searchPath(p, product), map[string]string{"X-Install-Id": uuid.NewString()})
	expect(t, r, http.StatusOK, "")
	var out struct {
		Results []map[string]any `json:"results"`
	}
	r.decode(t, &out)
	for _, res := range out.Results {
		if st, _ := res["station"].(map[string]any); st["id"] == stationID {
			return res
		}
	}
	return nil
}

func TestReportValidationAndLimits(t *testing.T) {
	admin := adminClient(t)
	prod, other := newProduct(t), newProduct(t)
	at := offset(calavi, 6000)
	_, stationID := readyStation(t, admin, at, map[int16]int{prod: 10, other: 4})
	near := move(at, 400, 300)
	far := move(at, 2600, 0)

	// Compte non vérifié : refusé.
	u := newClient(t)
	s := registerUser(t, u, uniqueEmail("nonverif"))
	u.bearer = s.AccessToken
	expect(t, postReport(u, stationID, reportBody(report.ReasonOutOfStock, prod, &near, "")), http.StatusForbidden, auth.CodeEmailNotVerified)

	c, sess, _ := verifiedUser(t)
	// Position obligatoire et à 2 km au plus pour une rupture ou une fermeture.
	expect(t, postReport(c, stationID, reportBody(report.ReasonOutOfStock, prod, nil, "")), http.StatusUnprocessableEntity, "request.validation_failed")
	expect(t, postReport(c, stationID, reportBody(report.ReasonStationClosed, 0, &far, "")), http.StatusUnprocessableEntity, report.CodeTooFar)
	expect(t, postReport(c, stationID, reportBody(report.ReasonOutOfStock, newProduct(t), &near, "")), http.StatusUnprocessableEntity, "request.validation_failed")
	expect(t, postReport(c, stationID, reportBody(report.ReasonOther, 0, nil, "")), http.StatusUnprocessableEntity, "request.validation_failed")
	expect(t, postReport(c, stationID, reportBody(report.ReasonOther, 0, nil, strings.Repeat("é", 301))), http.StatusUnprocessableEntity, "request.validation_failed")
	expect(t, postReport(c, stationID, reportBody(report.ReasonWrongLocation, prod, nil, "")), http.StatusUnprocessableEntity, "request.validation_failed")

	r := postReport(c, stationID, reportBody(report.ReasonOutOfStock, prod, &near, ""))
	expect(t, r, http.StatusCreated, "")
	expect(t, postReport(c, stationID, reportBody(report.ReasonOther, 0, nil, strings.Repeat("é", 300))), http.StatusCreated, "")
	expect(t, postReport(c, stationID, reportBody(report.ReasonWrongLocation, 0, nil, "")), http.StatusCreated, "")

	// 1 par station et par motif (produit compris) toutes les 2 h.
	expect(t, postReport(c, stationID, reportBody(report.ReasonOutOfStock, prod, &near, "")), http.StatusConflict, report.CodeDuplicate)
	expect(t, postReport(c, stationID, reportBody(report.ReasonOutOfStock, other, &near, "")), http.StatusCreated, "")
	if _, err := it.pool.Exec(t.Context(), `UPDATE reports SET created_at = now() - interval '2 hours 1 minute'
		WHERE reporter_id = $1 AND product_id = $2`, sess.User.ID, prod); err != nil {
		t.Fatal(err)
	}
	expect(t, postReport(c, stationID, reportBody(report.ReasonOutOfStock, prod, &near, "")), http.StatusCreated, "")
	// Le signalement vieilli revient à aujourd'hui (le compte du jour ne dépend pas de l'heure du test).
	if _, err := it.pool.Exec(t.Context(), `UPDATE reports SET created_at = now()
		WHERE reporter_id = $1 AND created_at < now() - interval '2 hours'`, sess.User.ID); err != nil {
		t.Fatal(err)
	}

	// 10 par jour et par utilisateur (5 enregistrés ci-dessus, dont un ramené 2 h en arrière).
	for i := range 5 {
		_, st := readyStation(t, admin, offset(calavi, float64(8000+i*500)), map[int16]int{prod: 1})
		expect(t, postReport(c, st, reportBody(report.ReasonWrongLocation, 0, nil, "")), http.StatusCreated, "")
	}
	_, last := readyStation(t, admin, offset(calavi, 11000), map[int16]int{prod: 1})
	expect(t, postReport(c, last, reportBody(report.ReasonWrongLocation, 0, nil, "")), http.StatusTooManyRequests, report.CodeDailyLimit)

	// Retrait du droit de signaler par l'admin, puis rétablissement.
	b, bsess, _ := verifiedUser(t)
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/users/"+bsess.User.ID+"/reporting-ban", map[string]string{}), http.StatusUnprocessableEntity, "request.validation_failed")
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/users/"+bsess.User.ID+"/reporting-ban", map[string]string{"reason": "Signalements abusifs répétés"}), http.StatusNoContent, "")
	expect(t, postReport(b, stationID, reportBody(report.ReasonWrongLocation, 0, nil, "")), http.StatusForbidden, report.CodeReportingSuspended)
	expect(t, admin.do(http.MethodDelete, "/api/v1/admin/users/"+bsess.User.ID+"/reporting-ban", nil), http.StatusNoContent, "")
	expect(t, postReport(b, stationID, reportBody(report.ReasonWrongLocation, 0, nil, "")), http.StatusCreated, "")
	if !contains(auditActions(t, "user", bsess.User.ID), "admin.reporting_banned", "admin.reporting_unbanned") {
		t.Error("reporting ban not audited")
	}
}

// TestReportPositionNeverStored : la position de l'auteur sert au contrôle des 2 km, puis
// disparaît : ni en base, ni dans les logs, ni dans Redis.
func TestReportPositionNeverStored(t *testing.T) {
	ctx := t.Context()
	admin := adminClient(t)
	prod := newProduct(t)
	at := offset(bohicon, 6000)
	_, stationID := readyStation(t, admin, at, map[int16]int{prod: 3})
	c, _, _ := verifiedUser(t)
	p := [2]float64{at[0] + 0.0012345, at[1] + 0.0016789}
	needles := []string{fmt.Sprintf("%.7f", p[0]), fmt.Sprintf("%.7f", p[1]), fmt.Sprintf("%.6f", p[0]), fmt.Sprintf("%.6f", p[1])}
	r := postReport(c, stationID, map[string]any{"reason": "station_closed", "position": map[string]float64{"lat": p[0], "lng": p[1]}})
	expect(t, r, http.StatusCreated, "")
	var rep struct {
		ID string `json:"id"`
	}
	r.decode(t, &rep)
	expect(t, postReport(c, stationID, map[string]any{"reason": "out_of_stock", "productId": prod, "position": map[string]float64{"lat": p[0] + 1, "lng": p[1]}}),
		http.StatusUnprocessableEntity, report.CodeTooFar)
	drainQueues(t)

	var row string
	if err := it.pool.QueryRow(ctx, `SELECT row_to_json(r)::text FROM reports r WHERE id = $1`, rep.ID).Scan(&row); err != nil {
		t.Fatal(err)
	}
	logs := it.logs.String()
	for _, needle := range needles {
		if strings.Contains(row, needle) {
			t.Errorf("report row contains %q: %s", needle, row)
		}
		if strings.Contains(logs, needle) {
			t.Errorf("logs contain %q", needle)
		}
	}
	keys, err := it.rdb.Keys(ctx, "*").Result()
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range keys {
		var vals []string
		switch typ, _ := it.rdb.Type(ctx, k).Result(); typ {
		case "string":
			v, _ := it.rdb.Get(ctx, k).Result()
			vals = []string{v}
		case "hash":
			h, _ := it.rdb.HGetAll(ctx, k).Result()
			for f, v := range h {
				vals = append(vals, f, v)
			}
		}
		for _, needle := range needles {
			if strings.Contains(k, needle) {
				t.Errorf("redis key %s contains the position", k)
			}
			for _, v := range vals {
				if strings.Contains(v, needle) {
					t.Errorf("redis value of %s contains the position", k)
				}
			}
		}
	}
}

func TestReportThresholds(t *testing.T) {
	admin := adminClient(t)
	prod := newProduct(t)
	at := offset(parakou, 6000)
	m, stationID := readyStation(t, admin, at, map[int16]int{prod: 20})
	token, _ := registerDevice(t, m, "fr")
	near := move(at, 300, 0)
	searcher := move(at, 1500, 0)

	reporters := make([]*client, 6)
	for i := range reporters {
		reporters[i], _, _ = verifiedUser(t)
	}
	outOfStock := reportBody(report.ReasonOutOfStock, prod, &near, "")

	for _, c := range reporters[:2] {
		expect(t, postReport(c, stationID, outOfStock), http.StatusCreated, "")
	}
	if res := searchFor(t, searcher, prod, stationID); res == nil || res["reported"] != false {
		t.Fatalf("2 reports: search result = %v, want present and not reported", res)
	}

	// 3 auteurs distincts : badge « signalé » (recherche et fiche) et notification au gérant.
	expect(t, postReport(reporters[2], stationID, outOfStock), http.StatusCreated, "")
	if res := searchFor(t, searcher, prod, stationID); res == nil || res["reported"] != true {
		t.Fatalf("3 reports: search result = %v, want reported", res)
	}
	var page struct {
		Reported bool `json:"reported"`
		Stocks   []struct {
			ProductID int16 `json:"productId"`
			Reported  bool  `json:"reported"`
		} `json:"stocks"`
	}
	newClient(t).do(http.MethodGet, "/api/v1/stations/"+stationID, nil).decode(t, &page)
	if page.Reported || len(page.Stocks) != 1 || !page.Stocks[0].Reported {
		t.Fatalf("public page = %+v, want the product reported", page)
	}
	msg := it.expo.waitFor(t, token, 1)[0]
	if msg.Data["type"] != "station_reported" || msg.Data["level"] != "flagged" || msg.Data["reporters"] != float64(3) {
		t.Fatalf("manager push = %+v", msg.Data)
	}
	for _, k := range []string{"reporterId", "email", "userId"} {
		if _, ok := msg.Data[k]; ok {
			t.Errorf("manager notification exposes %s", k)
		}
	}

	// 4e : rien de nouveau ; 5e : exclusion, alerte admin, nouvelle notification.
	expect(t, postReport(reporters[3], stationID, outOfStock), http.StatusCreated, "")
	expect(t, postReport(reporters[4], stationID, outOfStock), http.StatusCreated, "")
	if res := searchFor(t, searcher, prod, stationID); res != nil {
		t.Fatalf("5 reports: station still in search: %v", res)
	}
	if openAlerts(t, admin, "reports_threshold", stationID) != 1 {
		t.Fatal("no reports_threshold alert for the admin")
	}
	msgs := it.expo.waitFor(t, token, 2)
	if len(msgs) != 2 || msgs[1].Data["level"] != "excluded" {
		t.Fatalf("manager pushes = %d, last level %v", len(msgs), msgs[len(msgs)-1].Data["level"])
	}

	// Vue gérant : effets en cours et signalements, sans auteurs ni commentaires.
	var mine struct {
		Flags []struct {
			Reason string `json:"reason"`
			Level  string `json:"level"`
		} `json:"flags"`
		Items []map[string]any `json:"items"`
	}
	r := m.do(http.MethodGet, "/api/v1/manager/reports", nil)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &mine)
	if len(mine.Flags) != 1 || mine.Flags[0].Level != "excluded" || len(mine.Items) != 5 {
		t.Fatalf("manager reports = %+v", mine)
	}
	if body := r.Body.String(); strings.Contains(body, "reporterId") || strings.Contains(body, "email") || strings.Contains(body, "comment") {
		t.Error("manager view exposes reporters or comments")
	}

	// Confirmation du gérant : signalements clos, effets levés, alerte résolue.
	expect(t, confirmStocks(t, m), http.StatusOK, "")
	if res := searchFor(t, searcher, prod, stationID); res == nil || res["reported"] != false {
		t.Fatalf("after confirmation: search result = %v", res)
	}
	var open int
	if err := it.pool.QueryRow(t.Context(), `SELECT count(*) FROM reports WHERE station_id = $1 AND status = 'open'`, stationID).Scan(&open); err != nil || open != 0 {
		t.Fatalf("open reports after confirmation = %d (%v)", open, err)
	}
	if openAlerts(t, admin, "reports_threshold", stationID) != 0 {
		t.Error("reports_threshold alert still open after confirmation")
	}

	// Station signalée fermée par 3 auteurs (toute la station), puis un signalement classé
	// abusif par l'admin : l'effet retombe sous le seuil.
	closed := reportBody(report.ReasonStationClosed, 0, &near, "")
	var ids []string
	for _, c := range reporters[:3] {
		r := postReport(c, stationID, closed)
		expect(t, r, http.StatusCreated, "")
		var rep struct {
			ID string `json:"id"`
		}
		r.decode(t, &rep)
		ids = append(ids, rep.ID)
	}
	newClient(t).do(http.MethodGet, "/api/v1/stations/"+stationID, nil).decode(t, &page)
	if !page.Reported {
		t.Fatal("station reported closed by 3 users but the page is not flagged")
	}
	var dismissed struct {
		Status   string `json:"status"`
		Abusive  bool   `json:"abusive"`
		Reporter struct {
			AbusiveReports int `json:"abusiveReports"`
		} `json:"reporter"`
	}
	r = admin.do(http.MethodPost, "/api/v1/admin/reports/"+ids[0]+"/dismiss", map[string]any{"abusive": true, "note": "Station ouverte, vérifié par téléphone"})
	expect(t, r, http.StatusOK, "")
	r.decode(t, &dismissed)
	if dismissed.Status != "dismissed" || !dismissed.Abusive || dismissed.Reporter.AbusiveReports != 1 {
		t.Fatalf("dismissed report = %+v", dismissed)
	}
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/reports/"+ids[0]+"/dismiss", map[string]any{}), http.StatusConflict, "resource.conflict")
	newClient(t).do(http.MethodGet, "/api/v1/stations/"+stationID, nil).decode(t, &page)
	if page.Reported {
		t.Fatal("flag kept after an abusive report was dismissed (2 reporters left)")
	}
	r = admin.do(http.MethodPost, "/api/v1/admin/reports/"+ids[1]+"/resolve", map[string]any{"note": "Gérant contacté"})
	expect(t, r, http.StatusOK, "")

	// Liste admin : commentaire et auteur visibles pour la modération.
	var list struct {
		Items []struct {
			ID       string `json:"id"`
			Reporter *struct {
				Email string `json:"email"`
			} `json:"reporter"`
		} `json:"items"`
	}
	admin.do(http.MethodGet, "/api/v1/admin/reports?stationId="+stationID+"&status=open", nil).decode(t, &list)
	if len(list.Items) != 1 || list.Items[0].ID != ids[2] || list.Items[0].Reporter == nil || list.Items[0].Reporter.Email == "" {
		t.Fatalf("admin open reports = %+v", list.Items)
	}
	if !contains(auditActions(t, "report", ids[0]), "admin.report_dismissed") {
		t.Error("dismissal not audited")
	}
}

// reportStatus renvoie le statut d'un signalement.
func reportStatus(t *testing.T, id string) string {
	t.Helper()
	var s string
	if err := it.pool.QueryRow(t.Context(), `SELECT status::text FROM reports WHERE id = $1`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

// flagReasons renvoie les causes en cours d'effet (badge ou exclusion) d'une station.
func flagReasons(t *testing.T, stationID string) []string {
	t.Helper()
	rows, err := it.pool.Query(t.Context(), `SELECT reason::text FROM station_report_flags WHERE station_id = $1 ORDER BY reason::text`, stationID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

func createReport(t *testing.T, c *client, stationID string, body map[string]any) string {
	t.Helper()
	r := postReport(c, stationID, body)
	expect(t, r, http.StatusCreated, "")
	var rep struct {
		ID string `json:"id"`
	}
	r.decode(t, &rep)
	return rep.ID
}

// Clôture automatique (étape 7) : la saisie ou la confirmation des stocks ne clôt que les ruptures
// des produits concernés et « station fermée » ; « position incorrecte » se clôt au changement de
// position ; « autre » uniquement par l'admin.
func TestReportAutoClosure(t *testing.T) {
	admin := adminClient(t)
	gas, petrol, dropped := newProduct(t), newProduct(t), newProduct(t)
	at := offset(bohicon, 21000)
	m, stationID := readyStation(t, admin, at, map[int16]int{gas: 5, petrol: 8, dropped: 2})
	near := move(at, 400, 0)

	reporters := make([]*client, 3)
	for i := range reporters {
		reporters[i], _, _ = verifiedUser(t)
	}
	var gasIDs, locationIDs, otherIDs []string
	for _, c := range reporters {
		gasIDs = append(gasIDs, createReport(t, c, stationID, reportBody(report.ReasonOutOfStock, gas, &near, "")))
		locationIDs = append(locationIDs, createReport(t, c, stationID, reportBody(report.ReasonWrongLocation, 0, nil, "")))
		otherIDs = append(otherIDs, createReport(t, c, stationID, reportBody(report.ReasonOther, 0, nil, "Pompe hors service")))
	}
	closedID := createReport(t, reporters[0], stationID, reportBody(report.ReasonStationClosed, 0, &near, ""))
	droppedID := createReport(t, reporters[0], stationID, reportBody(report.ReasonOutOfStock, dropped, &near, ""))
	if got := flagReasons(t, stationID); fmt.Sprint(got) != "[other out_of_stock wrong_location]" {
		t.Fatalf("flags before the update = %v", got)
	}

	// La station ne vend plus « dropped » : la saisie ne concerne que gas et petrol.
	expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/products", etag(t, m, "/api/v1/manager/station/products"),
		map[string]any{"productIds": []int16{gas, petrol}}), http.StatusOK, "")
	expect(t, updateStocks(t, m, map[int16]int{gas: 0, petrol: 8}), http.StatusOK, "")
	for _, id := range append(gasIDs, closedID) {
		if s := reportStatus(t, id); s != "resolved" {
			t.Fatalf("report %s after a stock update = %s, want resolved", id, s)
		}
	}
	for _, id := range append(append([]string{droppedID}, locationIDs...), otherIDs...) {
		if s := reportStatus(t, id); s != "open" {
			t.Fatalf("report %s closed by a stock update (status %s)", id, s)
		}
	}
	if got := flagReasons(t, stationID); fmt.Sprint(got) != "[other wrong_location]" {
		t.Fatalf("flags after the update = %v, want wrong_location and other kept", got)
	}
	var page struct {
		Reported bool `json:"reported"`
	}
	newClient(t).do(http.MethodGet, "/api/v1/stations/"+stationID, nil).decode(t, &page)
	if !page.Reported {
		t.Fatal("station badge lifted by a stock update although wrong_location and other are still open")
	}

	// Une confirmation ne clôt pas davantage ; une correction de l'épingle clôt « position incorrecte ».
	expect(t, confirmStocks(t, m), http.StatusOK, "")
	if s := reportStatus(t, locationIDs[0]); s != "open" {
		t.Fatalf("wrong_location closed by a confirmation (%s)", s)
	}
	expect(t, pin(t, m, move(at, 50, 0), nil), http.StatusOK, "")
	for _, id := range locationIDs {
		if s := reportStatus(t, id); s != "resolved" {
			t.Fatalf("wrong_location report after a location change = %s", s)
		}
	}
	if got := flagReasons(t, stationID); fmt.Sprint(got) != "[other]" {
		t.Fatalf("flags after the location change = %v", got)
	}

	// « Autre » : seul l'admin le clôt ; traité, son effet est recalculé (2 auteurs : plus de badge).
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/reports/"+otherIDs[0]+"/resolve", map[string]any{"note": "Pompe réparée"}), http.StatusOK, "")
	if got := flagReasons(t, stationID); len(got) != 0 {
		t.Fatalf("flags after the admin resolved an 'other' report = %v", got)
	}
	newClient(t).do(http.MethodGet, "/api/v1/stations/"+stationID, nil).decode(t, &page)
	if page.Reported {
		t.Fatal("station still reported after the admin handled the 'other' cause")
	}
	if s := reportStatus(t, otherIDs[1]); s != "open" {
		t.Fatalf("other report closed without the admin (%s)", s)
	}
}
