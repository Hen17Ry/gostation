//go:build integration

package app_test

import (
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/app"
	"gostation/backend/internal/apperr"
	"gostation/backend/internal/platform/storage"
	"gostation/backend/internal/privacy"
	"gostation/backend/internal/retention"
)

type dataExportResp struct {
	Status      string     `json:"status"`
	CreatedAt   *time.Time `json:"createdAt"`
	ExpiresAt   *time.Time `json:"expiresAt"`
	SizeBytes   *int64     `json:"sizeBytes"`
	DownloadURL *string    `json:"downloadUrl"`
}

type dataRequestResp struct {
	ID          string     `json:"id"`
	Reference   string     `json:"reference"`
	Type        string     `json:"type"`
	Status      string     `json:"status"`
	Source      string     `json:"source"`
	CreatedAt   time.Time  `json:"createdAt"`
	DueAt       time.Time  `json:"dueAt"`
	CompletedAt *time.Time `json:"completedAt"`
	Response    *string    `json:"response"`
}

type adminDataRequestResp struct {
	dataRequestResp
	Details     *string    `json:"details"`
	VerifiedAt  *time.Time `json:"verifiedAt"`
	Overdue     bool       `json:"overdue"`
	DueSoon     bool       `json:"dueSoon"`
	HandledBy   *string    `json:"handledBy"`
	CodePending bool       `json:"codePending"`
	User        *struct {
		Email   string `json:"email"`
		Role    string `json:"role"`
		Deleted bool   `json:"deleted"`
	} `json:"user"`
	Actions struct {
		Verify        bool `json:"verify"`
		Export        bool `json:"export"`
		DeleteAccount bool `json:"deleteAccount"`
		Close         bool `json:"close"`
	} `json:"actions"`
}

type adminDataRequestPage struct {
	Items []struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Status   string `json:"status"`
		Verified bool   `json:"verified"`
		Overdue  bool   `json:"overdue"`
		DueSoon  bool   `json:"dueSoon"`
		User     *struct {
			Email string `json:"email"`
		} `json:"user"`
	} `json:"items"`
	NextCursor *string `json:"nextCursor"`
}

func (p adminDataRequestPage) has(id string) bool {
	for _, it := range p.Items {
		if it.ID == id {
			return true
		}
	}
	return false
}

// personalExport est le contenu de la copie des données (sous-ensemble vérifié par les tests).
type personalExport struct {
	Format       string            `json:"format"`
	About        map[string]string `json:"about"`
	NotCollected []string          `json:"notCollected"`
	Account      map[string]any    `json:"account"`
	Devices      []map[string]any  `json:"devices"`
	Reports      []map[string]any  `json:"reports"`
	DataRequests []map[string]any  `json:"dataRequests"`
	AuditTrail   []map[string]any  `json:"auditTrail"`
	Sessions     []map[string]any  `json:"sessions"`
	Station      map[string]any    `json:"station"`
	Document     *struct {
		MimeType      string `json:"mimeType"`
		ContentBase64 string `json:"contentBase64"`
	} `json:"stationDocument"`
}

func requestExport(t *testing.T, c *client) dataExportResp {
	t.Helper()
	r := c.do(http.MethodPost, "/api/v1/me/data-export", nil)
	expect(t, r, http.StatusAccepted, "")
	var e dataExportResp
	r.decode(t, &e)
	return e
}

func exportStatus(t *testing.T, c *client) dataExportResp {
	t.Helper()
	r := c.do(http.MethodGet, "/api/v1/me/data-export", nil)
	expect(t, r, http.StatusOK, "")
	if r.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("data export Cache-Control = %q", r.Header().Get("Cache-Control"))
	}
	var e dataExportResp
	r.decode(t, &e)
	return e
}

// readyExport laisse le worker générer la copie et la renvoie, prête.
func readyExport(t *testing.T, c *client) dataExportResp {
	t.Helper()
	drainQueues(t)
	e := exportStatus(t, c)
	if e.Status != "ready" || e.DownloadURL == nil {
		t.Fatalf("export after generation = %+v", e)
	}
	return e
}

func downloadExport(t *testing.T, c *client, e dataExportResp) (personalExport, string) {
	t.Helper()
	r := c.do(http.MethodGet, *e.DownloadURL, nil)
	expect(t, r, http.StatusOK, "")
	cd := r.Header().Get("Content-Disposition")
	if !strings.HasPrefix(cd, `attachment; filename="gostation-mes-donnees-`) || r.Header().Get("Cache-Control") != "no-store" ||
		!strings.HasPrefix(r.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("download headers = %v", r.Header())
	}
	var doc personalExport
	r.decode(t, &doc)
	return doc, r.Body.String()
}

// exportID extrait l'identifiant de la copie de son lien de téléchargement.
func exportID(t *testing.T, e dataExportResp) (uuid.UUID, url.Values) {
	t.Helper()
	u, err := url.Parse(*e.DownloadURL)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(u.Path, "/")
	return uuid.MustParse(parts[len(parts)-2]), u.Query()
}

func expectAppErr(t *testing.T, err error, status int, code string) {
	t.Helper()
	var ae *apperr.Error
	if !errors.As(err, &ae) || ae.Status != status || ae.Code != code {
		t.Fatalf("err = %v, want %d %s", err, status, code)
	}
}

func createDataRequest(t *testing.T, c *client, kind, details string) dataRequestResp {
	t.Helper()
	r := c.do(http.MethodPost, "/api/v1/me/data-requests", map[string]string{"type": kind, "details": details})
	expect(t, r, http.StatusCreated, "")
	var d dataRequestResp
	r.decode(t, &d)
	return d
}

func myDataRequests(t *testing.T, c *client) []dataRequestResp {
	t.Helper()
	r := c.do(http.MethodGet, "/api/v1/me/data-requests", nil)
	expect(t, r, http.StatusOK, "")
	var out struct {
		Items []dataRequestResp `json:"items"`
	}
	r.decode(t, &out)
	return out.Items
}

func adminDataRequest(t *testing.T, admin *client, id string) (adminDataRequestResp, string) {
	t.Helper()
	r := admin.do(http.MethodGet, "/api/v1/admin/data-requests/"+id, nil)
	expect(t, r, http.StatusOK, "")
	var d adminDataRequestResp
	r.decode(t, &d)
	return d, r.Header().Get("ETag")
}

// adminAction envoie une action sur une demande (If-Match) et renvoie la demande et son ETag.
func adminAction(t *testing.T, admin *client, id, action, etag string, body any, status int) (adminDataRequestResp, string) {
	t.Helper()
	r := admin.doIf(http.MethodPost, "/api/v1/admin/data-requests/"+id+"/"+action, etag, body)
	expect(t, r, status, "")
	var d adminDataRequestResp
	r.decode(t, &d)
	return d, r.Header().Get("ETag")
}

func adminDataRequests(t *testing.T, admin *client, query string) adminDataRequestPage {
	t.Helper()
	r := admin.do(http.MethodGet, "/api/v1/admin/data-requests?"+query, nil)
	expect(t, r, http.StatusOK, "")
	var p adminDataRequestPage
	r.decode(t, &p)
	return p
}

// recordEmailRequest enregistre une demande reçue par email et renvoie le code envoyé à la personne.
func recordEmailRequest(t *testing.T, admin *client, email, kind string) (adminDataRequestResp, string, string) {
	t.Helper()
	before := len(codesSent(t, email))
	r := admin.do(http.MethodPost, "/api/v1/admin/data-requests", map[string]string{"email": email, "type": kind})
	expect(t, r, http.StatusCreated, "")
	var d adminDataRequestResp
	r.decode(t, &d)
	if r.Header().Get("Location") != "/api/v1/admin/data-requests/"+d.ID {
		t.Errorf("Location = %q", r.Header().Get("Location"))
	}
	return d, r.Header().Get("ETag"), waitNewCode(t, email, before)
}

// codesSent renvoie les codes de confirmation reçus par email, du plus récent au plus ancien.
func codesSent(t *testing.T, email string) []string {
	t.Helper()
	msgs, err := it.mailpit.Messages(t.Context(), email)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, m := range msgs {
		if strings.Contains(m.Subject, "Confirmez votre demande") {
			code, err := m.Code()
			if err != nil {
				t.Fatal(err)
			}
			out = append(out, code)
		}
	}
	return out
}

func waitNewCode(t *testing.T, email string, before int) string {
	t.Helper()
	var codes []string
	waitUntil(t, "confirmation code email", func() bool {
		codes = codesSent(t, email)
		return len(codes) > before
	})
	return codes[0]
}

func otherCode(code string) string {
	if code == "000000" {
		return "111111"
	}
	return "000000"
}

func waitMail(t *testing.T, email, subject string) string {
	t.Helper()
	m, err := it.mailpit.WaitFor(t.Context(), email, subject)
	if err != nil {
		t.Fatalf("email %q: %v", subject, err)
	}
	return m.Text
}

func queryInt64(t *testing.T, sql string, args ...any) int64 {
	t.Helper()
	var n int64
	if err := it.pool.QueryRow(t.Context(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func anyContains(list []string, sub string) bool {
	for _, v := range list {
		if strings.Contains(v, sub) {
			return true
		}
	}
	return false
}

func execSQL(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := it.pool.Exec(t.Context(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

// Copie des données : complète, réutilisée tant qu'elle est en cours ou prête, réservée à la
// personne, lien signé et périssable, supprimée à 24 h ; la demande d'export est tracée et close.
func TestPersonalDataExport(t *testing.T) {
	c, s, email := verifiedUser(t)
	uid := uuid.MustParse(s.User.ID)
	token, _ := registerDevice(t, c, "fr")
	createDataRequest(t, c, "opposition", "")

	if e := exportStatus(t, c); e.Status != "none" || e.DownloadURL != nil {
		t.Fatalf("export before any request = %+v", e)
	}
	first := requestExport(t, c)
	if first.Status != "pending" || first.DownloadURL != nil {
		t.Fatalf("export request = %+v", first)
	}
	if again := requestExport(t, c); again.CreatedAt == nil || !again.CreatedAt.Equal(*first.CreatedAt) {
		t.Fatalf("a pending export must be reused: %+v vs %+v", again, first)
	}
	e := readyExport(t, c)
	if e.SizeBytes == nil || *e.SizeBytes == 0 || e.ExpiresAt == nil || e.ExpiresAt.Sub(*e.CreatedAt) < 23*time.Hour {
		t.Fatalf("ready export = %+v", e)
	}
	if again := requestExport(t, c); !again.CreatedAt.Equal(*first.CreatedAt) || again.Status != "ready" {
		t.Fatalf("a ready export must be reused: %+v", again)
	}
	waitMail(t, email, "La copie de vos données est prête")

	doc, body := downloadExport(t, c, e)
	if doc.Format == "" || doc.About["account"] == "" || len(doc.NotCollected) == 0 {
		t.Errorf("export without its explanations: format=%q about=%v", doc.Format, doc.About)
	}
	if doc.Account["email"] != email || doc.Account["firstName"] != "Afi" {
		t.Errorf("account = %v", doc.Account)
	}
	if len(doc.Devices) != 1 || len(doc.Sessions) == 0 || doc.Station != nil || doc.Document != nil {
		t.Errorf("devices=%d sessions=%d station=%v document=%v", len(doc.Devices), len(doc.Sessions), doc.Station, doc.Document)
	}
	// Ni secret ni token complet : le hash du mot de passe et le token push n'en sortent jamais.
	if strings.Contains(body, token) || strings.Contains(body, "$argon2") || strings.Contains(strings.ToLower(body), "passwordhash") {
		t.Error("export contains a secret (push token or password hash)")
	}
	kinds := map[string]bool{}
	for _, d := range doc.DataRequests {
		kinds[d["type"].(string)] = true
	}
	if !kinds["opposition"] || !kinds["export"] {
		t.Errorf("data requests in export = %v", doc.DataRequests)
	}
	// La demande d'export est close automatiquement à la génération.
	closed := false
	for _, d := range myDataRequests(t, c) {
		if d.Type == "export" {
			closed = d.Status == "completed" && d.Source == "app" && d.CompletedAt != nil
		}
	}
	if !closed {
		t.Error("export request not closed after generation")
	}

	// Réservée à la personne : autre compte, aucune session, lien altéré.
	other, _, _ := verifiedUser(t)
	expect(t, other.do(http.MethodGet, *e.DownloadURL, nil), http.StatusNotFound, "")
	expect(t, newClient(t).do(http.MethodGet, *e.DownloadURL, nil), http.StatusUnauthorized, "")
	tampered := strings.Replace(*e.DownloadURL, "signature=", "signature=00", 1)
	expect(t, c.do(http.MethodGet, tampered, nil), http.StatusForbidden, privacy.CodeInvalidSignature)
	id, q := exportID(t, e)
	if !contains(auditActions(t, "personal_export", id.String()), "privacy.export_requested", "privacy.export_downloaded") {
		t.Error("export request or download not audited")
	}
	if strings.Contains(it.logs.String(), email) {
		t.Error("an email address reached the logs")
	}

	// Lien périmé après 15 minutes ; un nouveau lien est délivré tant que la copie existe.
	ctx, me := t.Context(), privacy.Actor{UserID: uid, Role: "user"}
	setClock(t, time.Now().Add(privacy.LinkTTL+time.Minute))
	_, err := it.svc.Privacy.DownloadExport(ctx, me, id, q.Get("expires"), q.Get("signature"))
	expectAppErr(t, err, http.StatusGone, privacy.CodeLinkExpired)
	fresh, err := it.svc.Privacy.ExportStatus(ctx, me)
	if err != nil || fresh.Status != "ready" || fresh.DownloadURL == nil {
		t.Fatalf("status after link expiry = %+v, %v", fresh, err)
	}

	// Copie supprimée après 24 heures : plus de lien, fichier et ligne purgés.
	setClock(t, time.Now().Add(privacy.ExportTTL+time.Hour))
	expired, err := it.svc.Privacy.ExportStatus(ctx, me)
	if err != nil || expired.Status != "expired" || expired.DownloadURL != nil {
		t.Fatalf("status after 24 h = %+v, %v", expired, err)
	}
	fq, _ := url.Parse(*fresh.DownloadURL)
	_, err = it.svc.Privacy.DownloadExport(ctx, me, id, fq.Query().Get("expires"), fq.Query().Get("signature"))
	expectAppErr(t, err, http.StatusGone, privacy.CodeLinkExpired)
	if n, err := it.svc.Retention.Run(ctx, "personal_exports"); err != nil || n < 1 {
		t.Fatalf("personal_exports purge = %d, %v", n, err)
	}
	if _, err := it.docs.Get(ctx, "personal-exports/"+id.String()+".json.bin"); !errors.Is(err, storage.ErrNotFound) {
		t.Errorf("export file still stored: %v", err)
	}
	if n := queryInt64(t, `SELECT count(*) FROM personal_exports WHERE id = $1`, id); n != 0 {
		t.Error("export row not purged")
	}
	if n, err := it.svc.Retention.Run(ctx, "personal_exports"); err != nil || n != 0 {
		t.Errorf("second purge = %d, %v (want 0)", n, err)
	}
}

// Copie d'un gérant (dossier en attente) : sa station et son justificatif.
func TestPersonalDataExportOfManager(t *testing.T) {
	c := newClient(t)
	file := []byte("%PDF-1.4 justificatif IFU")
	s := registerManager(t, c, uniqueEmail("export-manager"), file, "ifu.pdf")
	c.bearer = s.AccessToken
	requestExport(t, c)
	doc, _ := downloadExport(t, c, readyExport(t, c))
	if doc.Station == nil || doc.Station["id"] != s.User.Station.ID || doc.Station["ifu"] != "3201234567890" {
		t.Fatalf("station in export = %v", doc.Station)
	}
	if doc.Document == nil || doc.Document.MimeType != "application/pdf" {
		t.Fatalf("document in export = %+v", doc.Document)
	}
	if raw, err := base64.StdEncoding.DecodeString(doc.Document.ContentBase64); err != nil || string(raw) != string(file) {
		t.Errorf("document content differs (%v)", err)
	}
}

// Demandes faites depuis l'app : validation, accusé de réception, échéance, suivi et actions de
// l'admin (verrouillage optimiste, audit), réponse transmise, plafond de demandes ouvertes.
func TestDataRequestsFromApp(t *testing.T) {
	admin := adminClient(t)
	c, _, email := verifiedUser(t)

	for _, body := range []map[string]any{
		{"type": "export"},
		{"type": "unknown"},
		{"type": "rectification"},
		{"type": "other", "details": "court"},
		{"type": "access", "details": strings.Repeat("x", 2001)},
	} {
		expect(t, c.do(http.MethodPost, "/api/v1/me/data-requests", body), http.StatusUnprocessableEntity, apperr.CodeValidation)
	}
	expect(t, newClient(t).do(http.MethodPost, "/api/v1/me/data-requests", map[string]string{"type": "access"}), http.StatusUnauthorized, "")

	details := "Mon nom de famille est mal orthographié dans mon profil."
	dr := createDataRequest(t, c, "rectification", details)
	if dr.Status != "pending" || dr.Source != "app" || dr.Reference != privacy.Reference(uuid.MustParse(dr.ID)) {
		t.Fatalf("request = %+v", dr)
	}
	if due := dr.DueAt.Sub(dr.CreatedAt); due < 30*24*time.Hour-time.Minute || due > 30*24*time.Hour+time.Minute {
		t.Errorf("due in %s, want 30 days", due)
	}
	if txt := waitMail(t, email, "Votre demande a bien été reçue"); !strings.Contains(txt, dr.Reference) {
		t.Error("acknowledgement without the reference")
	}
	if mine := myDataRequests(t, c); len(mine) != 1 || mine[0].ID != dr.ID {
		t.Fatalf("my requests = %+v", mine)
	}

	// Côté admin : demande authentifiée (pas de code), précisions visibles.
	d, etag := adminDataRequest(t, admin, dr.ID)
	if d.VerifiedAt == nil || d.CodePending || d.Actions.Verify || !d.Actions.Export || d.Actions.DeleteAccount || !d.Actions.Close ||
		d.User == nil || d.User.Email != email || d.Details == nil || *d.Details != details {
		t.Fatalf("admin request = %+v", d)
	}
	if p := adminDataRequests(t, admin, "type=rectification&status=open"); !p.has(dr.ID) {
		t.Error("request missing from the open rectification requests")
	}
	if p := adminDataRequests(t, admin, "type=deletion"); p.has(dr.ID) {
		t.Error("type filter ignored")
	}
	for q, status := range map[string]int{
		"status=bogus": http.StatusUnprocessableEntity, "type=bogus": http.StatusUnprocessableEntity,
		"overdue=maybe": http.StatusBadRequest, "foo=1": http.StatusBadRequest,
	} {
		expect(t, admin.do(http.MethodGet, "/api/v1/admin/data-requests?"+q, nil), status, "")
	}
	expect(t, c.do(http.MethodGet, "/api/v1/admin/data-requests", nil), http.StatusForbidden, "")

	// Prise en charge et clôture, avec If-Match.
	base := "/api/v1/admin/data-requests/" + dr.ID
	expect(t, admin.do(http.MethodPost, base+"/start", nil), http.StatusPreconditionRequired, "")
	expect(t, admin.doIf(http.MethodPost, base+"/start", `"v99"`, nil), http.StatusPreconditionFailed, apperr.CodeVersionConflict)
	d, etag = adminAction(t, admin, dr.ID, "start", etag, nil, http.StatusOK)
	if d.Status != "in_progress" || d.HandledBy == nil {
		t.Fatalf("started request = %+v", d)
	}
	for _, body := range []map[string]string{
		{"outcome": "done", "response": "Corrigé."}, {"outcome": "completed", "response": "ok"}, {"outcome": "rejected"},
	} {
		expect(t, admin.doIf(http.MethodPost, base+"/close", etag, body), http.StatusUnprocessableEntity, apperr.CodeValidation)
	}
	answer := "Votre nom a été corrigé dans votre profil."
	d, etag = adminAction(t, admin, dr.ID, "close", etag, map[string]string{"outcome": "completed", "response": answer}, http.StatusOK)
	if d.Status != "completed" || d.CompletedAt == nil || d.Response == nil || *d.Response != answer || d.Actions.Close {
		t.Fatalf("closed request = %+v", d)
	}
	if txt := waitMail(t, email, "Votre demande a été traitée"); !strings.Contains(txt, answer) {
		t.Error("closing email without the answer")
	}
	expect(t, admin.doIf(http.MethodPost, base+"/close", etag, map[string]string{"outcome": "completed", "response": answer}), http.StatusConflict, privacy.CodeClosed)
	if mine := myDataRequests(t, c); mine[0].Status != "completed" || mine[0].Response == nil || *mine[0].Response != answer {
		t.Errorf("my closed request = %+v", mine[0])
	}
	if !contains(auditActions(t, "data_request", dr.ID), "privacy.request_created", "admin.data_request_started", "admin.data_request_closed") {
		t.Errorf("audit = %v", auditActions(t, "data_request", dr.ID))
	}

	// Refus motivé.
	opp := createDataRequest(t, c, "opposition", "")
	_, etag = adminDataRequest(t, admin, opp.ID)
	reason := "Ce traitement est nécessaire à la sécurité du service."
	if d, _ = adminAction(t, admin, opp.ID, "close", etag, map[string]string{"outcome": "rejected", "response": reason}, http.StatusOK); d.Status != "rejected" {
		t.Fatalf("rejected request = %+v", d)
	}
	if txt := waitMail(t, email, "Réponse à votre demande"); !strings.Contains(txt, reason) {
		t.Error("refusal email without the reason")
	}

	// Échéance : bientôt due (7 jours) et dépassée, dans les compteurs et le filtre.
	before := counters(t, admin)
	soon, late := createDataRequest(t, c, "access", ""), createDataRequest(t, c, "access", "")
	execSQL(t, `UPDATE data_requests SET due_at = now() + interval '3 days' WHERE id = $1`, soon.ID)
	execSQL(t, `UPDATE data_requests SET due_at = now() - interval '1 day' WHERE id = $1`, late.ID)
	after := counters(t, admin)
	if after.DataRequests.Open != before.DataRequests.Open+2 || after.DataRequests.DueSoon != before.DataRequests.DueSoon+1 ||
		after.DataRequests.Overdue != before.DataRequests.Overdue+1 {
		t.Errorf("counters %+v → %+v", before.DataRequests, after.DataRequests)
	}
	if d, _ = adminDataRequest(t, admin, soon.ID); !d.DueSoon || d.Overdue {
		t.Errorf("soon = %+v", d)
	}
	if d, _ = adminDataRequest(t, admin, late.ID); !d.Overdue || d.DueSoon {
		t.Errorf("late = %+v", d)
	}
	if p := adminDataRequests(t, admin, "overdue=true"); !p.has(late.ID) || p.has(soon.ID) {
		t.Error("overdue filter")
	}

	// Plafond : 5 demandes ouvertes au plus.
	for range privacy.MaxOpenPerUser - 2 {
		createDataRequest(t, c, "other", "Question sur l'usage de mes données.")
	}
	expect(t, c.do(http.MethodPost, "/api/v1/me/data-requests", map[string]string{"type": "access"}), http.StatusConflict, privacy.CodeTooManyOpen)

	// Export admin « demandes » : le suivi, jamais le contenu.
	e := runExport(t, admin, map[string]any{"dataset": "data_requests"})
	r := download(t, admin, e)
	rows := readCSV(t, r)
	if column(t, rows, "type") < 0 || column(t, rows, "overdue") < 0 {
		t.Fatal("data_requests export columns")
	}
	if b := r.Body.String(); strings.Contains(b, details) || strings.Contains(b, answer) || strings.Contains(b, email) {
		t.Error("data_requests export leaks the content of a request")
	}
}

// Demande reçue par email : rien n'est traité avant le code envoyé à l'adresse du compte ; essais
// limités, nouveau code ; l'admin génère la copie, que la personne télécharge dans son app.
func TestDataRequestByEmail(t *testing.T) {
	admin := adminClient(t)
	c, _, email := verifiedUser(t)

	expect(t, admin.do(http.MethodPost, "/api/v1/admin/data-requests", map[string]string{"email": uniqueEmail("nobody"), "type": "access"}),
		http.StatusNotFound, privacy.CodeAccountNotFound)
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/data-requests", map[string]string{"email": email, "type": "bogus"}),
		http.StatusUnprocessableEntity, apperr.CodeValidation)

	d, etag, code := recordEmailRequest(t, admin, email, "access")
	if d.Source != "email" || d.VerifiedAt != nil || !d.CodePending || !d.Actions.Verify || d.Actions.Export || !d.Actions.Close {
		t.Fatalf("email request = %+v", d)
	}
	if mailCount := len(myDataRequests(t, c)); mailCount != 1 {
		t.Errorf("the person sees %d requests, want 1", mailCount)
	}
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/data-requests/"+d.ID+"/export", etag, nil), http.StatusConflict, privacy.CodeNotVerified)
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/data-requests/"+d.ID+"/start", etag, nil), http.StatusConflict, privacy.CodeNotVerified)
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/data-requests/"+d.ID+"/verify", etag, map[string]string{"code": otherCode(code)}),
		http.StatusBadRequest, privacy.CodeInvalidCode)
	d, etag = adminAction(t, admin, d.ID, "verify", etag, map[string]string{"code": code}, http.StatusOK)
	if d.VerifiedAt == nil || d.CodePending || !d.Actions.Export {
		t.Fatalf("verified request = %+v", d)
	}
	waitMail(t, email, "Votre demande a bien été reçue")
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/data-requests/"+d.ID+"/verify", etag, map[string]string{"code": code}),
		http.StatusConflict, privacy.CodeAlreadyVerified)

	// Copie générée par l'admin : la réponse ne contient aucun lien, la personne la télécharge.
	r := admin.doIf(http.MethodPost, "/api/v1/admin/data-requests/"+d.ID+"/export", etag, nil)
	expect(t, r, http.StatusAccepted, "")
	if strings.Contains(r.Body.String(), "download") {
		t.Error("the admin must never get the export")
	}
	r.decode(t, &d)
	if d.Status != "in_progress" {
		t.Errorf("request after export = %+v", d)
	}
	doc, _ := downloadExport(t, c, readyExport(t, c))
	if doc.Account["email"] != email {
		t.Error("export of the wrong account")
	}
	if !contains(auditActions(t, "data_request", d.ID), "privacy.request_created", "admin.data_request_code_sent", "admin.data_request_verified") {
		t.Errorf("audit = %v", auditActions(t, "data_request", d.ID))
	}

	// Essais épuisés : le bon code ne vaut plus ; un nouveau code est envoyé.
	d2, etag2, code2 := recordEmailRequest(t, admin, email, "opposition")
	for range privacy.CodeAttempts {
		expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/data-requests/"+d2.ID+"/verify", etag2, map[string]string{"code": otherCode(code2)}),
			http.StatusBadRequest, privacy.CodeInvalidCode)
	}
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/data-requests/"+d2.ID+"/verify", etag2, map[string]string{"code": code2}),
		http.StatusBadRequest, privacy.CodeInvalidCode)
	before := len(codesSent(t, email))
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/data-requests/"+d2.ID+"/code", nil), http.StatusOK, "")
	code3 := waitNewCode(t, email, before)
	if d2, _ = adminAction(t, admin, d2.ID, "verify", etag2, map[string]string{"code": code3}, http.StatusOK); d2.VerifiedAt == nil {
		t.Fatalf("request after new code = %+v", d2)
	}
}

// Suppression exécutée par l'admin sur une demande confirmée.
func TestDeletionRequestExecutedByAdmin(t *testing.T) {
	admin := adminClient(t)
	c, s, email := verifiedUser(t)
	registerDevice(t, c, "fr")

	access, etag, code := recordEmailRequest(t, admin, email, "access")
	_, accessETag := adminAction(t, admin, access.ID, "verify", etag, map[string]string{"code": code}, http.StatusOK)
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/data-requests/"+access.ID+"/delete-account", accessETag, nil),
		http.StatusConflict, privacy.CodeWrongType)

	del, etag, code := recordEmailRequest(t, admin, email, "deletion")
	d, etag := adminAction(t, admin, del.ID, "verify", etag, map[string]string{"code": code}, http.StatusOK)
	if !d.Actions.DeleteAccount {
		t.Fatalf("verified deletion request = %+v", d)
	}
	d, _ = adminAction(t, admin, del.ID, "delete-account", etag, map[string]string{}, http.StatusOK)
	if d.Status != "completed" || d.User == nil || !d.User.Deleted || d.Actions.Close || d.Actions.Export {
		t.Fatalf("request after deletion = %+v", d)
	}
	expect(t, c.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, "")
	if n := queryInt64(t, `SELECT count(*) FROM users WHERE id = $1 AND status = 'pending_deletion' AND email LIKE 'deleted+%'`, s.User.ID); n != 1 {
		t.Error("account not anonymized")
	}
	if n := queryInt64(t, `SELECT count(*) FROM device_tokens WHERE user_id = $1`, s.User.ID); n != 0 {
		t.Error("devices not removed")
	}
	waitMail(t, email, "Votre compte a été supprimé")
	if !anyContains(auditEntries(t, "user", s.User.ID, "user.account_deleted"), `"cause": "request"`) {
		t.Errorf("deletion audit = %v", auditEntries(t, "user", s.User.ID, "user.account_deleted"))
	}
	// Le compte n'existe plus : la copie ne peut plus être générée.
	expect(t, admin.doIf(http.MethodPost, "/api/v1/admin/data-requests/"+access.ID+"/export", accessETag, nil),
		http.StatusConflict, privacy.CodeAccountDeleted)
}

// Compte désactivé par un admin : la suppression demandée par email aboutit, et ne laisse ni la
// désactivation ni ses motifs libres.
func TestDeletionOfDisabledAccount(t *testing.T) {
	admin := adminClient(t)
	_, s, email := verifiedUser(t)
	execSQL(t, `UPDATE users SET status = 'disabled', disabled_at = now(), disabled_reason = 'Usurpation signalée',
		reporting_banned_at = now(), reporting_ban_reason = 'Signalements abusifs' WHERE id = $1`, s.User.ID)
	d, etag, code := recordEmailRequest(t, admin, email, "deletion")
	_, etag = adminAction(t, admin, d.ID, "verify", etag, map[string]string{"code": code}, http.StatusOK)
	if d, _ = adminAction(t, admin, d.ID, "delete-account", etag, map[string]string{}, http.StatusOK); d.Status != "completed" {
		t.Fatalf("request = %+v", d)
	}
	if n := queryInt64(t, `SELECT count(*) FROM users WHERE id = $1 AND status = 'pending_deletion' AND disabled_reason IS NULL
		AND reporting_ban_reason IS NULL AND disabled_at IS NULL`, s.User.ID); n != 1 {
		t.Error("disabled account not fully anonymized")
	}
}

// Gérant d'une station approuvée : la station est suspendue (retirée de la recherche), le lien avec
// le compte rompu, le justificatif conservé selon sa durée.
func TestApprovedManagerDeletion(t *testing.T) {
	admin := adminClient(t)
	gas := newProduct(t)
	m, stationID := readyStation(t, admin, offset(calavi, 63000), map[int16]int{gas: 4})
	expect(t, m.do(http.MethodDelete, "/api/v1/me", map[string]string{"password": password}), http.StatusNoContent, "")
	var status string
	var managerGone, deletedAt, document bool
	if err := it.pool.QueryRow(t.Context(), `SELECT status, manager_id IS NULL, manager_deleted_at IS NOT NULL, document_object_key IS NOT NULL
		FROM stations WHERE id = $1`, stationID).Scan(&status, &managerGone, &deletedAt, &document); err != nil {
		t.Fatal(err)
	}
	if status != "suspended" || !managerGone || !deletedAt || !document {
		t.Errorf("station after manager deletion: status=%s detached=%v deletedAt=%v document=%v", status, managerGone, deletedAt, document)
	}
	if r := newClient(t).get(searchPath(offset(calavi, 63000), gas), nil); strings.Contains(r.Body.String(), stationID) {
		t.Error("suspended station still in search")
	}
}

// Purges : chaque règle avec une horloge injectée ; la simulation compte sans rien modifier, un
// deuxième passage ne traite rien.
func TestRetentionPurges(t *testing.T) {
	ctx := t.Context()
	admin := adminClient(t)
	gas := newProduct(t)
	m, stationID := readyStation(t, admin, offset(calavi, 67000), map[int16]int{gas: 5})
	c, s, _ := verifiedUser(t)
	uid := s.User.ID
	registerDevice(t, c, "fr")
	expect(t, postReport(c, stationID, reportBody("other", 0, nil, "Pompe en panne depuis hier")), http.StatusCreated, "")
	c2, s2, _ := verifiedUser(t)
	expect(t, postReport(c2, stationID, reportBody("other", 0, nil, "Station fermée ce matin")), http.StatusCreated, "")
	rejected := registerManager(t, newClient(t), uniqueEmail("rejected"), []byte("%PDF-1.4 refusé"), "ifu.pdf")
	inactive, si, inactiveEmail := verifiedUser(t)
	_, sb, backEmail := verifiedUser(t)
	_ = inactive

	now := time.Now().UTC().Truncate(time.Second)
	setClock(t, now)
	days := func(n int) time.Time { return now.AddDate(0, 0, -n) }

	execSQL(t, `INSERT INTO notifications (user_id, type, created_at) VALUES ($1, 'station_decision', $2), ($1, 'station_decision', $3)`, uid, days(31), days(29))
	execSQL(t, `INSERT INTO back_in_stock_alerts (user_id, station_id, product_id, status, created_at, sent_at) VALUES ($1, $2, $3, 'sent', $4, $4)`,
		uid, stationID, gas, days(31))
	execSQL(t, `UPDATE device_tokens SET last_seen_at = $2 WHERE user_id = $1`, uid, days(91))
	execSQL(t, `UPDATE reports SET created_at = $2 WHERE reporter_id = $1`, uid, days(91))
	execSQL(t, `UPDATE reports SET created_at = $2 WHERE reporter_id = $1`, s2.User.ID, days(366))
	var auditID int64
	if err := it.pool.QueryRow(ctx, `INSERT INTO audit_logs (action, entity_type, entity_id, created_at) VALUES ('test.old', 'test', $1, $2) RETURNING id`,
		uid, days(366)).Scan(&auditID); err != nil {
		t.Fatal(err)
	}
	execSQL(t, `UPDATE stock_history SET created_at = $2 WHERE station_id = $1`, stationID, days(366))
	history := queryInt64(t, `SELECT count(*) FROM stock_history WHERE station_id = $1`, stationID)
	// Le trigger date le changement de statut : la date est vieillie dans une seconde requête.
	execSQL(t, `UPDATE stations SET status = 'rejected', status_reason = 'Justificatif illisible.' WHERE id = $1`, rejected.User.Station.ID)
	execSQL(t, `UPDATE stations SET status_changed_at = $2 WHERE id = $1`, rejected.User.Station.ID, days(183))
	var rejectedKey string
	if err := it.pool.QueryRow(ctx, `SELECT document_object_key FROM stations WHERE id = $1`, rejected.User.Station.ID).Scan(&rejectedKey); err != nil {
		t.Fatal(err)
	}
	// Station dont le gérant a été supprimé il y a plus de 12 mois.
	expect(t, m.do(http.MethodDelete, "/api/v1/me", map[string]string{"password": password}), http.StatusNoContent, "")
	execSQL(t, `UPDATE stations SET manager_deleted_at = $2 WHERE id = $1`, stationID, days(366))
	var oldRequest string
	if err := it.pool.QueryRow(ctx, `INSERT INTO data_requests (user_id, type, status, source, due_at, verified_at, response_note, created_at, completed_at)
		VALUES ($1, 'access', 'completed', 'app', $2, $2, 'Copie transmise.', $2, $2) RETURNING id`, uid, now.AddDate(-3, 0, -1)).Scan(&oldRequest); err != nil {
		t.Fatal(err)
	}
	// Demandes de déplacement (E6) : décidée ou remplacée il y a plus de 12 mois → supprimée ;
	// décidée il y a moins de 12 mois, ou encore en attente → conservée.
	at := func(t time.Time) *time.Time { return &t }
	locationRequest := func(status string, created time.Time, reviewed *time.Time) string {
		var id string
		if err := it.pool.QueryRow(ctx, `INSERT INTO station_location_requests (station_id, location, h3_r8, distance_m, status, reviewed_at, created_at)
			VALUES ($1, ST_SetSRID(ST_MakePoint(2.35, 6.45), 4326)::geography, 0, 350, $2, $3, $4) RETURNING id`,
			stationID, status, reviewed, created).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	oldMove := locationRequest("approved", days(380), at(days(366)))
	oldSuperseded := locationRequest("superseded", days(366), nil)
	recentMove := locationRequest("rejected", days(380), at(days(364)))
	pendingMove := locationRequest("pending", days(400), nil)
	// Deux comptes inactifs depuis 701 jours ; le second se reconnecte après l'avertissement.
	execSQL(t, `UPDATE users SET last_active_at = $2 WHERE id = ANY($1)`, []string{si.User.ID, sb.User.ID}, days(701))

	// Simulation : des compteurs, aucun effet.
	sims, err := it.svc.Retention.DryRun(ctx)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int64{}
	for _, sim := range sims {
		counts[sim.Rule] = sim.Count
	}
	for _, rule := range []string{
		"notifications", "back_in_stock_alerts", "device_tokens", "inactive_accounts_warning", "report_authors", "reports",
		"audit_logs", "station_documents", "stock_history", "data_requests", "location_requests",
	} {
		if counts[rule] < 1 {
			t.Errorf("dry run: %s = %d, want ≥ 1", rule, counts[rule])
		}
	}
	if counts["station_documents"] < 2 || counts["inactive_accounts_warning"] < 2 || counts["stock_history"] < history {
		t.Errorf("dry run counts = %v", counts)
	}
	if again, _ := it.svc.Retention.DryRun(ctx); len(again) != len(sims) {
		t.Fatal("dry run rules changed")
	} else {
		for i := range again {
			if again[i] != sims[i] {
				t.Errorf("dry run had an effect: %v → %v", sims[i], again[i])
			}
		}
	}
	if queryInt64(t, `SELECT count(*) FROM notifications WHERE user_id = $1`, uid) != 2 || queryInt64(t, `SELECT count(*) FROM audit_logs WHERE id = $1`, auditID) != 1 {
		t.Fatal("dry run deleted rows")
	}

	// Chaque règle traite ce que la simulation annonçait ; un deuxième passage ne traite rien.
	for _, rule := range it.svc.Retention.Rules() {
		n, err := it.svc.Retention.Run(ctx, rule.Name)
		if err != nil || n != counts[rule.Name] {
			t.Errorf("%s: %d rows, %v (dry run: %d)", rule.Name, n, err, counts[rule.Name])
		}
		if n, err := it.svc.Retention.Run(ctx, rule.Name); err != nil || n != 0 {
			t.Errorf("%s second run: %d rows, %v", rule.Name, n, err)
		}
		if retention.TaskType(rule.Name) != "retention:"+rule.Name || rule.Spec == "" {
			t.Errorf("%s: task %q, spec %q", rule.Name, retention.TaskType(rule.Name), rule.Spec)
		}
	}

	if n := queryInt64(t, `SELECT count(*) FROM notifications WHERE user_id = $1`, uid); n != 1 {
		t.Errorf("notifications left = %d, want 1 (the 29-day one)", n)
	}
	if n := queryInt64(t, `SELECT count(*) FROM back_in_stock_alerts WHERE user_id = $1`, uid); n != 0 {
		t.Error("old back-in-stock alert kept")
	}
	if n := queryInt64(t, `SELECT count(*) FROM device_tokens WHERE user_id = $1`, uid); n != 0 {
		t.Error("unused device kept")
	}
	var pseudo string
	if err := it.pool.QueryRow(ctx, `SELECT reporter_pseudonym FROM reports
		WHERE station_id = $1 AND reporter_id IS NULL AND pseudonymized_at IS NOT NULL AND comment = 'Pompe en panne depuis hier'`, stationID).Scan(&pseudo); err != nil {
		t.Fatalf("report author not pseudonymized: %v", err)
	}
	if !strings.HasPrefix(pseudo, "u_") || len(pseudo) != 18 || strings.Contains(pseudo, uid) {
		t.Errorf("pseudonym = %q", pseudo)
	}
	if n := queryInt64(t, `SELECT count(*) FROM reports WHERE station_id = $1 AND comment = 'Station fermée ce matin'`, stationID); n != 0 {
		t.Error("12-month-old report kept")
	}
	if n := queryInt64(t, `SELECT count(*) FROM audit_logs WHERE id = $1`, auditID); n != 0 {
		t.Error("old audit entry kept")
	}
	if n := queryInt64(t, `SELECT count(*) FROM stock_history WHERE station_id = $1`, stationID); n != 0 {
		t.Error("old stock history kept")
	}
	if n := queryInt64(t, `SELECT coalesce(sum(changes), 0) FROM stock_history_daily WHERE station_id = $1 AND product_id = $2`,
		stationID, gas); n != history {
		t.Errorf("aggregated changes = %d, want %d", n, history)
	}
	for _, id := range []string{rejected.User.Station.ID, stationID} {
		if n := queryInt64(t, `SELECT count(*) FROM stations WHERE id = $1 AND document_object_key IS NULL AND document_deleted_at IS NOT NULL`, id); n != 1 {
			t.Errorf("document of station %s kept", id)
		}
	}
	if _, err := it.docs.Get(ctx, rejectedKey); !errors.Is(err, storage.ErrNotFound) {
		t.Errorf("rejected document file kept: %v", err)
	}
	if n := queryInt64(t, `SELECT count(*) FROM data_requests WHERE id = $1`, oldRequest); n != 0 {
		t.Error("3-year-old closed request kept")
	}
	if n := queryInt64(t, `SELECT count(*) FROM station_location_requests WHERE id = ANY($1)`, []string{oldMove, oldSuperseded}); n != 0 {
		t.Errorf("%d location requests decided over 12 months ago kept", n)
	}
	if n := queryInt64(t, `SELECT count(*) FROM station_location_requests WHERE id = ANY($1)`, []string{recentMove, pendingMove}); n != 2 {
		t.Errorf("recent or pending location requests deleted: %d left, want 2", n)
	}

	// Avertissement d'inactivité : email, puis une connexion annule l'avertissement.
	if txt := waitMail(t, inactiveEmail, "va être supprimé"); !strings.Contains(txt, "connectez-vous") {
		t.Error("inactivity warning text")
	}
	waitMail(t, backEmail, "va être supprimé")
	login(t, newClient(t), backEmail, password)
	if n := queryInt64(t, `SELECT count(*) FROM users WHERE id = $1 AND inactivity_warned_at IS NULL`, sb.User.ID); n != 1 {
		t.Error("login did not cancel the inactivity warning")
	}

	// 30 jours plus tard : suppression du compte prévenu et resté inactif.
	setClock(t, now.Add(31*24*time.Hour))
	if n, err := it.svc.Retention.Run(ctx, "inactive_accounts"); err != nil || n != 1 {
		t.Fatalf("inactive_accounts = %d, %v (want 1)", n, err)
	}
	if n, err := it.svc.Retention.Run(ctx, "inactive_accounts"); err != nil || n != 0 {
		t.Errorf("inactive_accounts second run = %d, %v", n, err)
	}
	if n := queryInt64(t, `SELECT count(*) FROM users WHERE id = $1 AND status = 'pending_deletion'`, si.User.ID); n != 1 {
		t.Error("inactive account not deleted")
	}
	if n := queryInt64(t, `SELECT count(*) FROM users WHERE id = $1 AND status = 'active'`, sb.User.ID); n != 1 {
		t.Error("account active again was deleted")
	}
	waitMail(t, inactiveEmail, "Votre compte a été supprimé")
	if !anyContains(auditEntries(t, "user", si.User.ID, "user.account_deleted"), `"cause": "inactivity"`) {
		t.Errorf("inactivity deletion audit = %v", auditEntries(t, "user", si.User.ID, "user.account_deleted"))
	}
	if strings.Contains(it.logs.String(), inactiveEmail) {
		t.Error("an email address reached the logs")
	}
}

// Nouvelle version de la politique (1.1 fictive) : réacceptation exigée des comptes existants et
// de toute nouvelle inscription.
func TestPrivacyPolicyNewVersion(t *testing.T) {
	c, _, _ := verifiedUser(t)
	cfg := it.cfg
	cfg.Auth.PrivacyPolicyVersion = "1.1"
	svc, err := app.NewServices(cfg, app.Infra{Pool: it.pool, Redis: it.rdb, Mailer: it.mailer, Storage: it.docs, Clock: it.clock.Now},
		slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Jobs.Close() })
	h, _ := app.NewHandler(cfg, svc, it.rdb, slog.New(slog.DiscardHandler))
	c.handler = h

	type policy struct {
		PrivacyPolicy struct {
			AcceptedVersion  string `json:"acceptedVersion"`
			CurrentVersion   string `json:"currentVersion"`
			ReacceptRequired bool   `json:"reacceptRequired"`
		} `json:"privacyPolicy"`
	}
	var me policy
	r := c.do(http.MethodGet, "/api/v1/me", nil)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &me)
	if !me.PrivacyPolicy.ReacceptRequired || me.PrivacyPolicy.AcceptedVersion != "1.0" || me.PrivacyPolicy.CurrentVersion != "1.1" {
		t.Fatalf("policy with 1.1 published = %+v", me.PrivacyPolicy)
	}
	expect(t, c.do(http.MethodPost, "/api/v1/me/accept-privacy-policy", map[string]string{"version": "1.0"}), http.StatusUnprocessableEntity, apperr.CodeValidation)
	r = c.do(http.MethodPost, "/api/v1/me/accept-privacy-policy", map[string]string{"version": "1.1"})
	expect(t, r, http.StatusOK, "")
	me = policy{}
	r.decode(t, &me)
	if me.PrivacyPolicy.ReacceptRequired || me.PrivacyPolicy.AcceptedVersion != "1.1" {
		t.Fatalf("policy after acceptance = %+v", me.PrivacyPolicy)
	}

	n := newClient(t)
	n.handler = h
	body := map[string]string{"firstName": "Afi", "lastName": "Dossou", "email": uniqueEmail("policy"), "password": password, "privacyPolicyVersion": "1.0"}
	expect(t, n.do(http.MethodPost, "/api/v1/auth/register", body), http.StatusUnprocessableEntity, apperr.CodeValidation)
	body["privacyPolicyVersion"] = "1.1"
	expect(t, n.do(http.MethodPost, "/api/v1/auth/register", body), http.StatusCreated, "")
}
