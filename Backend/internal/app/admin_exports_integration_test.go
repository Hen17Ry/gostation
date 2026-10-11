//go:build integration

package app_test

import (
	"bytes"
	"encoding/csv"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"gostation/backend/internal/export"
	"gostation/backend/internal/platform/storage"
)

type exportResp struct {
	ID       string  `json:"id"`
	Dataset  string  `json:"dataset"`
	Format   string  `json:"format"`
	Status   string  `json:"status"`
	Error    *string `json:"error"`
	RowCount *int    `json:"rowCount"`
	Params   struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"params"`
	ExpiresAt *time.Time `json:"expiresAt"`
	Download  *struct {
		URL       string    `json:"url"`
		ExpiresAt time.Time `json:"expiresAt"`
	} `json:"download"`
}

// runExport lance un export, laisse le worker le générer et renvoie l'export prêt.
func runExport(t *testing.T, admin *client, body map[string]any) exportResp {
	t.Helper()
	r := admin.do(http.MethodPost, "/api/v1/admin/exports", body)
	expect(t, r, http.StatusAccepted, "")
	var e exportResp
	r.decode(t, &e)
	if e.Status != "pending" || r.Header().Get("Location") != "/api/v1/admin/exports/"+e.ID {
		t.Fatalf("export request = %+v (Location %q)", e, r.Header().Get("Location"))
	}
	drainQueues(t)
	r = admin.do(http.MethodGet, "/api/v1/admin/exports/"+e.ID, nil)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &e)
	if e.Status != "ready" || e.Download == nil {
		t.Fatalf("export after generation = %+v", e)
	}
	return e
}

func download(t *testing.T, admin *client, e exportResp) response {
	t.Helper()
	r := admin.do(http.MethodGet, e.Download.URL, nil)
	expect(t, r, http.StatusOK, "")
	return r
}

// readCSV vérifie l'en-tête Excel (BOM UTF-8, « ; ») et renvoie les lignes.
func readCSV(t *testing.T, r response) [][]string {
	t.Helper()
	body := r.Body.Bytes()
	if !bytes.HasPrefix(body, []byte("\xEF\xBB\xBF")) {
		t.Fatal("CSV without UTF-8 BOM")
	}
	if !strings.HasPrefix(r.Header().Get("Content-Disposition"), "attachment; filename=") || r.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("download headers = %v", r.Header())
	}
	cr := csv.NewReader(bytes.NewReader(body[3:]))
	cr.Comma = ';'
	rows, err := cr.ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func column(t *testing.T, rows [][]string, name string) int {
	t.Helper()
	for i, c := range rows[0] {
		if c == name {
			return i
		}
	}
	t.Fatalf("column %s missing in %v", name, rows[0])
	return -1
}

func TestAdminExports(t *testing.T) {
	admin := adminClient(t)
	gas := newProduct(t)
	at := offset(calavi, 52000)
	_, stationID := readyStation(t, admin, at, map[int16]int{gas: 12})
	var ifu, rccm string
	if err := it.pool.QueryRow(t.Context(), `SELECT ifu, rccm FROM stations WHERE id = $1`, stationID).Scan(&ifu, &rccm); err != nil {
		t.Fatal(err)
	}
	// Nom piégé : une formule ne doit jamais s'exécuter dans le tableur.
	if _, err := it.pool.Exec(t.Context(), `UPDATE stations SET name = '=HYPERLINK("http://evil")' WHERE id = $1`, stationID); err != nil {
		t.Fatal(err)
	}
	reporter, _, reporterEmail := verifiedUser(t)
	expect(t, postReport(reporter, stationID, reportBody("other", 0, nil, "Pompe 2 en panne depuis ce matin")), http.StatusCreated, "")
	visible, masked := statsCell(t, [2]float64{7.5, 2.2}), statsCell(t, [2]float64{7.7, 2.4})
	recordStats(t, localTime(-3, 10, 0), visible, gas, 9, 3)
	recordStats(t, localTime(-3, 10, 0), masked, gas, 2, 2)
	flushStats(t)

	// Validation stricte.
	for _, body := range []map[string]any{
		{"dataset": "users"},
		{"dataset": "stations", "format": "xlsx"},
		{"dataset": "stations", "from": day(3)},
		{"dataset": "reports", "productId": gas},
		{"dataset": "search_stats", "from": day(3), "to": localTime(2, 12, 0).Format(time.DateOnly)},
		{"dataset": "audit", "from": day(1), "to": day(5)},
		{"dataset": "audit", "from": day(400)},
	} {
		expect(t, admin.do(http.MethodPost, "/api/v1/admin/exports", body), http.StatusUnprocessableEntity, "request.validation_failed")
	}

	// Stations : IFU et RCCM, formule neutralisée.
	e := runExport(t, admin, map[string]any{"dataset": "stations"})
	rows := readCSV(t, download(t, admin, e))
	idCol, ifuCol, rccmCol, nameCol := column(t, rows, "id"), column(t, rows, "ifu"), column(t, rows, "rccm"), column(t, rows, "name")
	found := false
	for _, row := range rows[1:] {
		if row[idCol] == stationID {
			found = row[ifuCol] == ifu && row[rccmCol] == rccm && row[nameCol] == `'=HYPERLINK("http://evil")`
		}
	}
	if !found || *e.RowCount != len(rows)-1 {
		t.Fatalf("stations export misses the station with IFU/RCCM or the formula guard (%d rows)", len(rows)-1)
	}

	// Stocks actuels, en JSON.
	e = runExport(t, admin, map[string]any{"dataset": "stocks", "format": "json"})
	r := download(t, admin, e)
	if ct := r.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("JSON export content type = %q", ct)
	}
	var stocks struct {
		Dataset string           `json:"dataset"`
		Items   []map[string]any `json:"items"`
	}
	r.decode(t, &stocks)
	found = false
	for _, it := range stocks.Items {
		if it["stationId"] == stationID {
			found = it["quantity"] == float64(12) && it["freshness"] == "fresh"
		}
	}
	if stocks.Dataset != "stocks" || !found {
		t.Fatalf("stocks export misses the station stock (%d items)", len(stocks.Items))
	}

	// Signalements : auteur pseudonymisé, jamais d'email.
	e = runExport(t, admin, map[string]any{"dataset": "reports"})
	if e.Params.From != day(29) || e.Params.To != day(0) {
		t.Fatalf("default period = %s → %s, want the last 30 days", e.Params.From, e.Params.To)
	}
	r = download(t, admin, e)
	body := r.Body.String()
	if strings.Contains(body, reporterEmail) || strings.Contains(body, "@") {
		t.Fatal("reports export contains an email address")
	}
	rows = readCSV(t, r)
	repCol, comCol, stCol := column(t, rows, "reporter"), column(t, rows, "comment"), column(t, rows, "stationId")
	found = false
	for _, row := range rows[1:] {
		if row[stCol] == stationID && row[comCol] == "Pompe 2 en panne depuis ce matin" {
			found = strings.HasPrefix(row[repCol], "u_") && len(row[repCol]) == 18
		}
	}
	if !found {
		t.Fatalf("reports export misses the report or its pseudonym: %v", rows)
	}
	jr := runExport(t, admin, map[string]any{"dataset": "reports", "format": "json"})
	if strings.Contains(download(t, admin, jr).Body.String(), reporterEmail) {
		t.Fatal("JSON reports export contains the reporter email")
	}

	// Stats agrégées : seuil k ≥ 5, décimaux à virgule.
	e = runExport(t, admin, map[string]any{"dataset": "search_stats", "from": day(3), "to": day(3)})
	rows = readCSV(t, download(t, admin, e))
	cellCol, rateCol := column(t, rows, "cell"), column(t, rows, "emptyRate")
	var cells []string
	for _, row := range rows[1:] {
		cells = append(cells, row[cellCol])
		if row[cellCol] == visible.String() && !strings.HasPrefix(row[rateCol], "0,333") {
			t.Fatalf("empty rate cell = %q, want a decimal comma", row[rateCol])
		}
	}
	if !contains(cells, visible.String()) || contains(cells, masked.String()) {
		t.Fatalf("stats export cells = %v, want %s and never %s (k < 5)", cells, visible, masked)
	}

	// Journal d'audit : chaque export y figure (demande et téléchargement).
	e = runExport(t, admin, map[string]any{"dataset": "audit"})
	body = download(t, admin, e).Body.String()
	if !strings.Contains(body, "admin.export_requested") || !strings.Contains(body, "admin.export_downloaded") {
		t.Fatal("audit export misses the export entries")
	}
	if !contains(auditActions(t, "export", e.ID), "admin.export_requested", "admin.export_downloaded") {
		t.Fatal("export not audited")
	}

	// Lien signé : altéré → 403 ; expiré (plus d'une heure) → 410 ; un nouveau GET en donne un neuf.
	u, err := url.Parse(e.Download.URL)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("expires", "9999999999")
	expect(t, admin.do(http.MethodGet, u.Path+"?"+q.Encode(), nil), http.StatusForbidden, export.CodeInvalidSignature)
	setClock(t, time.Now().Add(61*time.Minute))
	expect(t, admin.do(http.MethodGet, e.Download.URL, nil), http.StatusGone, export.CodeLinkExpired)
	var fresh exportResp
	admin.do(http.MethodGet, "/api/v1/admin/exports/"+e.ID, nil).decode(t, &fresh)
	download(t, admin, fresh)
	// Le lien seul ne suffit pas : il faut une session admin.
	expect(t, newClient(t).do(http.MethodGet, fresh.Download.URL, nil), http.StatusUnauthorized, "auth.unauthorized")

	// Purge à 24 h : fichier supprimé, export expiré, téléchargement refusé.
	var key string
	if err := it.pool.QueryRow(t.Context(), `SELECT object_key FROM exports WHERE id = $1`, e.ID).Scan(&key); err != nil {
		t.Fatal(err)
	}
	setClock(t, time.Now().Add(23*time.Hour))
	if _, err := it.svc.Exports.Purge(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := it.docs.Get(t.Context(), key); err != nil {
		t.Fatal("export purged before 24 h")
	}
	setClock(t, time.Now().Add(24*time.Hour+time.Minute))
	var late exportResp // lien demandé juste avant la purge : valide, mais le fichier va disparaître
	admin.do(http.MethodGet, "/api/v1/admin/exports/"+e.ID, nil).decode(t, &late)
	if n, err := it.svc.Exports.Purge(t.Context()); err != nil || n == 0 {
		t.Fatalf("purge at 24 h = %d, %v", n, err)
	}
	if _, err := it.docs.Get(t.Context(), key); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("export file still stored after 24 h (%v)", err)
	}
	var gone exportResp
	admin.do(http.MethodGet, "/api/v1/admin/exports/"+e.ID, nil).decode(t, &gone)
	if gone.Status != "expired" || gone.Download != nil || late.Download == nil {
		t.Fatalf("purged export = %+v (link before purge %+v)", gone, late.Download)
	}
	expect(t, admin.do(http.MethodGet, late.Download.URL, nil), http.StatusGone, export.CodeExpired)

	// Liste des exports, la plus récente d'abord.
	var list struct {
		Items []exportResp `json:"items"`
	}
	admin.do(http.MethodGet, "/api/v1/admin/exports?limit=3", nil).decode(t, &list)
	if len(list.Items) != 3 || list.Items[0].ID != e.ID {
		t.Fatalf("exports list = %+v", list.Items)
	}
}
