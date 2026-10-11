//go:build integration

package app_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/auth"
	"gostation/backend/internal/http/handler"
)

// adminSessionWithoutMFA ouvre une session admin dont l'access token n'a pas le claim mfa : un tel
// jeton ne peut pas sortir du parcours de login (2FA obligatoire), on le forge pour vérifier que
// le serveur le refuse quand même.
func adminSessionWithoutMFA(t *testing.T) *client {
	t.Helper()
	email := uniqueEmail("nomfa")
	uid, err := it.svc.Auth.CreateAdmin(t.Context(), email, "Ada", "Sans2FA", password)
	if err != nil {
		t.Fatal(err)
	}
	sess, _, err := it.svc.Sessions.Create(t.Context(), auth.Session{UserID: uid, Role: "admin", Client: "web"}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	token, err := it.svc.Tokens.Issue(uid, "admin", sess.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	c := newClient(t)
	name := handler.Cookies{Secure: it.cfg.Auth.CookieSecure}.Access()
	c.cookies[name] = &http.Cookie{Name: name, Value: token}
	return c
}

func TestAdminAccessRequiresTwoFactorCookieAndCSRF(t *testing.T) {
	admin := adminClient(t)
	expect(t, admin.do(http.MethodGet, "/api/v1/admin/dashboard", nil), http.StatusOK, "")

	expect(t, newClient(t).do(http.MethodGet, "/api/v1/admin/dashboard", nil), http.StatusUnauthorized, "auth.unauthorized")
	u, _, _ := verifiedUser(t)
	expect(t, u.do(http.MethodGet, "/api/v1/admin/users", nil), http.StatusForbidden, "auth.forbidden")

	// Sans 2FA (claim mfa absent) : refusé, en lecture comme en écriture.
	noMFA := adminSessionWithoutMFA(t)
	expect(t, noMFA.do(http.MethodGet, "/api/v1/admin/dashboard", nil), http.StatusForbidden, "auth.forbidden")
	expect(t, noMFA.do(http.MethodGet, "/api/v1/admin/audit", nil), http.StatusForbidden, "auth.forbidden")

	// Sans jeton CSRF, ou avec un jeton faux : toute écriture est refusée.
	body := map[string]any{"kind": "lpg", "sizeKg": 42.5, "label": "Gaz test CSRF"}
	csrf := admin.csrf
	admin.csrf = ""
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/products", body), http.StatusForbidden, auth.CodeCSRFFailed)
	admin.csrf = "forged-" + csrf
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/exports", map[string]any{"dataset": "stations"}), http.StatusForbidden, auth.CodeCSRFFailed)
	admin.csrf = csrf

	// Un access token admin présenté en Bearer (hors session web) est refusé.
	var accessToken string
	accessCookie := handler.Cookies{Secure: it.cfg.Auth.CookieSecure}.Access()
	for _, ck := range admin.cookies {
		if ck.Name == accessCookie {
			accessToken = ck.Value
		}
	}
	bearer := newClient(t)
	bearer.bearer = accessToken
	expect(t, bearer.do(http.MethodGet, "/api/v1/admin/dashboard", nil), http.StatusForbidden, "auth.forbidden")

	// Validation stricte : paramètre inconnu.
	expect(t, admin.do(http.MethodGet, "/api/v1/admin/users?sort=email", nil), http.StatusBadRequest, "request.invalid_parameter")
}

type adminUserResp struct {
	ID             string  `json:"id"`
	Status         string  `json:"status"`
	EmailVerified  bool    `json:"emailVerified"`
	DisabledReason *string `json:"disabledReason"`
	ActiveSessions int     `json:"activeSessions"`
	Devices        int     `json:"devices"`
	Favorites      int     `json:"favorites"`
	Reports        struct {
		Total   int `json:"total"`
		Abusive int `json:"abusive"`
	} `json:"reports"`
}

func TestAdminUsers(t *testing.T) {
	admin := adminClient(t)
	c, s, email := verifiedUser(t)
	token, _ := registerDevice(t, c, "fr")
	other := newClient(t)
	other.bearer = login(t, other, email, password).AccessToken
	prod := newProduct(t)
	fav := seedStation(t, prod, seed{at: offset(parakou, 40000)}).String()
	expect(t, c.do(http.MethodPost, "/api/v1/me/favorites/"+fav, nil), http.StatusCreated, "")

	// Liste : recherche par email ou nom, filtres.
	var list struct {
		Items []struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"items"`
		NextCursor *string `json:"nextCursor"`
	}
	r := admin.do(http.MethodGet, "/api/v1/admin/users?role=user&emailVerified=true&q="+strings.Split(email, "@")[0], nil)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &list)
	if len(list.Items) != 1 || list.Items[0].ID != s.User.ID {
		t.Fatalf("user search = %+v", list.Items)
	}
	admin.do(http.MethodGet, "/api/v1/admin/users?q=Dossou&limit=1", nil).decode(t, &list)
	if len(list.Items) != 1 || list.NextCursor == nil {
		t.Fatalf("paginated name search = %+v", list)
	}
	expect(t, admin.do(http.MethodGet, "/api/v1/admin/users?role=superuser", nil), http.StatusUnprocessableEntity, "request.validation_failed")

	// Fiche : sessions actives, appareils, favoris, signalements.
	var u adminUserResp
	admin.do(http.MethodGet, "/api/v1/admin/users/"+s.User.ID, nil).decode(t, &u)
	if u.ActiveSessions != 2 || u.Devices != 1 || u.Favorites != 1 || u.Reports.Total != 0 || !u.EmailVerified {
		t.Fatalf("user detail = %+v", u)
	}

	// Désactivation : motif obligatoire ; sessions et appareils révoqués ; connexion refusée.
	path := "/api/v1/admin/users/" + s.User.ID
	expect(t, admin.do(http.MethodPost, path+"/disable", map[string]string{}), http.StatusUnprocessableEntity, "request.validation_failed")
	r = admin.do(http.MethodPost, path+"/disable", map[string]string{"reason": "Signalements frauduleux"})
	expect(t, r, http.StatusOK, "")
	r.decode(t, &u)
	if u.Status != "disabled" || u.ActiveSessions != 0 || u.Devices != 0 || u.DisabledReason == nil {
		t.Fatalf("disabled user = %+v", u)
	}
	expect(t, c.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, "auth.unauthorized")
	expect(t, other.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, "auth.unauthorized")
	var devices int
	if err := it.pool.QueryRow(t.Context(), `SELECT count(*) FROM device_tokens WHERE token = $1`, token).Scan(&devices); err != nil || devices != 0 {
		t.Fatalf("device of a disabled user still registered (%d, %v)", devices, err)
	}
	r = newClient(t).do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": password})
	expect(t, r, http.StatusForbidden, auth.CodeAccountDisabled)
	// Mauvais mot de passe : réponse générique (le statut du compte n'est pas révélé).
	r = newClient(t).do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": "Mauvais-Mot-2026"})
	expect(t, r, http.StatusUnauthorized, auth.CodeInvalidCredentials)
	expect(t, admin.do(http.MethodPost, path+"/disable", map[string]string{"reason": "Encore"}), http.StatusConflict, auth.CodeInvalidStatus)

	// Réactivation : la connexion refonctionne.
	expect(t, admin.do(http.MethodPost, path+"/reactivate", map[string]string{"reason": "Erreur de modération"}), http.StatusOK, "")
	login(t, newClient(t), email, password)
	if !contains(auditActions(t, "user", s.User.ID), "admin.user_disabled", "admin.user_reactivated") {
		t.Error("disable/reactivate not audited")
	}

	// Les comptes admin se gèrent par la CLI.
	adminID := adminUserID(t, admin)
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/users/"+adminID+"/disable", map[string]string{"reason": "Test"}), http.StatusForbidden, auth.CodeAdminProtected)
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/users/"+uuid.NewString()+"/disable", map[string]string{"reason": "Test"}), http.StatusNotFound, "resource.not_found")

	// Renvoi du code de vérification : compte non vérifié uniquement, dans les limites de renvoi.
	nv := newClient(t)
	nvEmail := uniqueEmail("nonverifie")
	nvs := registerUser(t, nv, nvEmail)
	latestCode(t, nvEmail, "Confirmez votre adresse") // code de l'inscription
	time.Sleep(10 * time.Millisecond)
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/users/"+nvs.User.ID+"/resend-verification", map[string]string{"reason": "Code non reçu"}),
		http.StatusTooManyRequests, "rate_limit.exceeded") // moins d'une minute après l'inscription
	if err := it.rdb.Del(t.Context(), "otp:cooldown:verify_email:"+nvs.User.ID).Err(); err != nil {
		t.Fatal(err)
	}
	before := mailCount(t, nvEmail)
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/users/"+nvs.User.ID+"/resend-verification", map[string]string{"reason": "Code non reçu"}), http.StatusAccepted, "")
	waitUntil(t, "verification email resent", func() bool { return mailCount(t, nvEmail) > before })
	expect(t, admin.do(http.MethodPost, path+"/resend-verification", map[string]string{"reason": "Code non reçu"}), http.StatusConflict, auth.CodeAlreadyVerified)
	if !contains(auditActions(t, "user", nvs.User.ID), "admin.verification_resent") {
		t.Error("verification resend not audited")
	}
}

// adminUserID renvoie l'identifiant de l'admin connecté.
func adminUserID(t *testing.T, admin *client) string {
	t.Helper()
	var me struct {
		ID string `json:"id"`
	}
	admin.do(http.MethodGet, "/api/v1/me", nil).decode(t, &me)
	return me.ID
}

// mailCount compte les emails reçus par une adresse.
func mailCount(t *testing.T, email string) int {
	t.Helper()
	msgs, err := it.mailpit.Messages(t.Context(), email)
	if err != nil {
		t.Fatal(err)
	}
	return len(msgs)
}

type adminProductResp struct {
	ID        int16    `json:"id"`
	Code      string   `json:"code"`
	Kind      string   `json:"kind"`
	Unit      string   `json:"unit"`
	SizeKg    *float64 `json:"sizeKg"`
	Label     string   `json:"label"`
	Active    bool     `json:"active"`
	SortOrder int      `json:"sortOrder"`
	Stations  int      `json:"stations"`
}

func TestAdminCatalog(t *testing.T) {
	admin := adminClient(t)

	// Validation stricte de la création.
	for _, body := range []map[string]any{
		{"kind": "lpg", "label": "Gaz sans taille"},
		{"kind": "petrol", "sizeKg": 10, "label": "Essence taillée"},
		{"kind": "lpg", "sizeKg": 0.3, "label": "Trop petit"},
		{"kind": "lpg", "sizeKg": 12.345, "label": "Trop précis"},
		{"kind": "kerosene", "label": "Pétrole lampant"},
		{"kind": "lpg", "sizeKg": 38.5, "label": "G"},
	} {
		expect(t, admin.do(http.MethodPost, "/api/v1/admin/products", body), http.StatusUnprocessableEntity, "request.validation_failed")
	}
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/products", map[string]any{"kind": "petrol", "label": "Essence bis"}), http.StatusConflict, "product.already_exists")

	var p adminProductResp
	r := admin.do(http.MethodPost, "/api/v1/admin/products", map[string]any{"kind": "lpg", "sizeKg": 38.5, "label": "Gaz 38,5 kg"})
	expect(t, r, http.StatusCreated, "")
	r.decode(t, &p)
	if p.Code != "lpg_38_5kg" || p.Unit != "cylinder" || p.SizeKg == nil || *p.SizeKg != 38.5 || !p.Active || p.SortOrder <= 0 {
		t.Fatalf("created product = %+v", p)
	}
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/products", map[string]any{"kind": "lpg", "sizeKg": 38.5, "label": "Doublon"}), http.StatusConflict, "product.already_exists")
	path := fmt.Sprintf("/api/v1/admin/products/%d", p.ID)

	// Type et taille figés ; libellé et ordre modifiables.
	expect(t, admin.do(http.MethodPatch, path, map[string]any{"kind": "petrol"}), http.StatusUnprocessableEntity, "request.validation_failed")
	r = admin.do(http.MethodPatch, path, map[string]any{"sizeKg": 40, "label": "Gaz 40 kg"})
	expect(t, r, http.StatusUnprocessableEntity, "request.validation_failed")
	if !strings.Contains(r.Body.String(), `"immutable"`) {
		t.Fatalf("immutable fields not reported: %s", r.Body.String())
	}
	expect(t, admin.do(http.MethodPatch, path, map[string]any{}), http.StatusUnprocessableEntity, "request.validation_failed")
	r = admin.do(http.MethodPatch, path, map[string]any{"label": "Gaz 38,5 kg (B)", "sortOrder": 77})
	expect(t, r, http.StatusOK, "")
	r.decode(t, &p)
	if p.Label != "Gaz 38,5 kg (B)" || p.SortOrder != 77 || p.Code != "lpg_38_5kg" || *p.SizeKg != 38.5 {
		t.Fatalf("patched product = %+v", p)
	}

	// Une station le vend : présent dans la recherche, le catalogue public et les choix du gérant.
	at := offset(bohicon, 32000)
	other := newProduct(t)
	m, stationID := readyStation(t, admin, at, map[int16]int{p.ID: 9, other: 4})
	if res, _ := searchOK(t, move(at, 300, 0), p.ID); len(res.Results) == 0 {
		t.Fatal("active product not found in search")
	}
	gen := func() string { v, _ := it.rdb.Get(t.Context(), fmt.Sprintf("search:gen:p%d", p.ID)).Result(); return v }
	genBefore := gen()

	// Désactivation : sort de la recherche, du catalogue public et des choix du gérant ; stocks et
	// historique conservés ; cache du produit invalidé.
	expect(t, admin.do(http.MethodPatch, path, map[string]any{"active": false}), http.StatusOK, "")
	if gen() == genBefore {
		t.Error("search cache generation not bumped by the deactivation")
	}
	r = newClient(t).get(searchPath(move(at, 300, 0), p.ID), map[string]string{"X-Install-Id": uuid.NewString()})
	expect(t, r, http.StatusUnprocessableEntity, "request.validation_failed")
	if strings.Contains(newClient(t).do(http.MethodGet, "/api/v1/products", nil).Body.String(), p.Code) {
		t.Error("deactivated product still in the public catalog")
	}
	if strings.Contains(m.do(http.MethodGet, "/api/v1/manager/station/products", nil).Body.String(), p.Code) {
		t.Error("deactivated product still offered to the manager")
	}
	var stockRows, historyRows int
	if err := it.pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM station_stocks WHERE station_id = $1 AND product_id = $2),
		(SELECT count(*) FROM stock_history WHERE station_id = $1 AND product_id = $2)`, stationID, p.ID).Scan(&stockRows, &historyRows); err != nil {
		t.Fatal(err)
	}
	if stockRows != 1 || historyRows == 0 {
		t.Fatalf("stock %d, history %d rows after deactivation; want both kept", stockRows, historyRows)
	}
	// Le gérant met à jour ses autres produits sans lui ; il ne peut plus le saisir.
	expect(t, confirmStocks(t, m), http.StatusOK, "")
	expect(t, updateStocks(t, m, map[int16]int{other: 5}), http.StatusOK, "")
	expect(t, updateStocks(t, m, map[int16]int{other: 5, p.ID: 3}), http.StatusUnprocessableEntity, "request.validation_failed")

	// Réactivation : de retour dans la recherche.
	expect(t, admin.do(http.MethodPatch, path, map[string]any{"active": true}), http.StatusOK, "")
	if res, _ := searchOK(t, move(at, 300, 0), p.ID); len(res.Results) == 0 {
		t.Fatal("reactivated product not found in search")
	}

	var list struct {
		Items []adminProductResp `json:"items"`
	}
	admin.do(http.MethodGet, "/api/v1/admin/products?limit=100", nil).decode(t, &list)
	found := false
	for _, it := range list.Items {
		if it.ID == p.ID {
			found = it.Stations == 1
		}
	}
	if !found {
		t.Fatalf("admin catalog misses the product or its station count: %+v", list.Items)
	}
	if !contains(auditActions(t, "product", fmt.Sprint(p.ID)), "admin.product_created", "admin.product_updated") {
		t.Error("catalog changes not audited")
	}
}

func TestAdminStationCorrection(t *testing.T) {
	admin := adminClient(t)
	_, stationID := approvedManager(t, admin)
	path := "/api/v1/admin/stations/" + stationID
	email := managerEmail(t, stationID)
	tag := etag(t, admin, path)
	newIFU := randomIFU()
	body := map[string]any{"name": "Station Akpakpa Centre", "ifu": newIFU, "reason": "Nom et IFU vérifiés auprès de la DGI"}

	expect(t, admin.do(http.MethodPatch, path, body), http.StatusPreconditionRequired, "request.precondition_required")
	expect(t, admin.doIf(http.MethodPatch, path, tag, map[string]any{"name": "Station Akpakpa Centre"}), http.StatusUnprocessableEntity, "request.validation_failed")
	expect(t, admin.doIf(http.MethodPatch, path, tag, map[string]any{"name": "X", "reason": "ok ok"}), http.StatusUnprocessableEntity, "request.validation_failed")
	expect(t, admin.doIf(http.MethodPatch, path, tag, map[string]any{"stocks": 3, "reason": "Pas de stocks"}), http.StatusUnprocessableEntity, "request.validation_failed")
	expect(t, admin.doIf(http.MethodPatch, path, `"v1"`, body), http.StatusPreconditionFailed, "resource.version_conflict")

	r := admin.doIf(http.MethodPatch, path, tag, body)
	expect(t, r, http.StatusOK, "")
	var st struct {
		Name    string `json:"name"`
		IFU     string `json:"ifu"`
		Status  string `json:"status"`
		Version int    `json:"version"`
	}
	r.decode(t, &st)
	if st.Name != "Station Akpakpa Centre" || st.IFU != newIFU || st.Status != "approved" {
		t.Fatalf("corrected station = %+v (status must stay approved)", st)
	}
	if got := r.Header().Get("ETag"); got == tag || got != fmt.Sprintf(`"v%d"`, st.Version) {
		t.Fatalf("ETag after correction = %s (before %s, version %d)", got, tag, st.Version)
	}
	msg, err := it.mailpit.WaitFor(t.Context(), email, "Informations de votre station corrigées")
	if err != nil {
		t.Fatal(err)
	}
	if text := msg.Text; !strings.Contains(text, "Nom et IFU vérifiés auprès de la DGI") || !strings.Contains(text, "nom, IFU") {
		t.Fatalf("correction email = %q", text)
	}
	entries := auditEntries(t, "station", stationID, "admin.station_corrected")
	if len(entries) != 1 || !strings.Contains(entries[0], `"reason"`) || !strings.Contains(entries[0], newIFU) {
		t.Fatalf("correction audit = %v", entries)
	}
}

// auditEntries renvoie les métadonnées des entrées d'une action sur une entité.
func auditEntries(t *testing.T, entityType, entityID, action string) []string {
	t.Helper()
	rows, err := it.svc.Store.ListAuditLogsByEntity(t.Context(), entityTypeParams(entityType, entityID))
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, r := range rows {
		if r.Action == action {
			out = append(out, string(r.Metadata))
		}
	}
	return out
}

func TestAdminStationFiltersAndMap(t *testing.T) {
	admin := adminClient(t)
	prod := newProduct(t)
	tag := "Filtre" + uuid.NewString()[:6]
	mk := func(suffix string, s seed, lastUpdate string) string {
		s.name, s.at = tag+" "+suffix, offset(parakou, 45000+float64(len(suffix))*300)
		id := seedStation(t, prod, s).String()
		if lastUpdate != "" {
			if _, err := it.pool.Exec(t.Context(), `UPDATE stations SET last_stock_update_at = now() - $2::interval WHERE id = $1`, id, lastUpdate); err != nil {
				t.Fatal(err)
			}
		}
		return id
	}
	fresh := mk("fraiche", seed{}, "1 hour")
	stale := mk("perimee", seed{age: 10 * time.Hour}, "10 hours")
	expired := mk("expiree", seed{age: 30 * time.Hour}, "30 hours")
	never := mk("jamais", seed{}, "")
	noHours := mk("sanshoraires", seed{noHours: true}, "1 hour")
	if _, err := it.pool.Exec(t.Context(), `INSERT INTO station_report_flags (station_id, reason, reporters) VALUES ($1, 'station_closed', 3)`, fresh); err != nil {
		t.Fatal(err)
	}
	if _, err := it.pool.Exec(t.Context(), `INSERT INTO admin_alerts (kind, station_id) VALUES ('manager_inactive', $1)`, stale); err != nil {
		t.Fatal(err)
	}

	list := func(filter string) []string {
		t.Helper()
		var out struct {
			Items []struct {
				ID        string `json:"id"`
				Freshness string `json:"freshness"`
			} `json:"items"`
		}
		r := admin.do(http.MethodGet, "/api/v1/admin/stations?status=approved&limit=100&q="+strings.ReplaceAll(tag, " ", "%20")+filter, nil)
		expect(t, r, http.StatusOK, "")
		r.decode(t, &out)
		ids := make([]string, 0, len(out.Items))
		for _, it := range out.Items {
			ids = append(ids, it.ID)
		}
		return ids
	}
	same := func(name string, got []string, want ...string) {
		t.Helper()
		if len(got) != len(want) || !contains(got, want...) {
			t.Errorf("%s = %v, want %v", name, got, want)
		}
	}
	same("all", list(""), fresh, stale, expired, never, noHours)
	same("stale", list("&freshness=stale"), stale)
	same("expired", list("&freshness=expired"), expired, never)
	same("manager inactive", list("&managerInactive=true"), stale)
	same("no hours", list("&noHours=true"), noHours)
	same("reported", list("&reported=true"), fresh)
	expect(t, admin.do(http.MethodGet, "/api/v1/admin/stations?freshness=old", nil), http.StatusUnprocessableEntity, "request.validation_failed")

	// Carte : GeoJSON léger de toutes les stations épinglées.
	r := admin.do(http.MethodGet, "/api/v1/admin/stations/map", nil)
	expect(t, r, http.StatusOK, "")
	if ct := r.Header().Get("Content-Type"); ct != "application/geo+json" {
		t.Fatalf("map content type = %q", ct)
	}
	var fc struct {
		Type     string `json:"type"`
		Features []struct {
			ID       string `json:"id"`
			Geometry struct {
				Type        string     `json:"type"`
				Coordinates [2]float64 `json:"coordinates"`
			} `json:"geometry"`
			Properties struct {
				Status    string `json:"status"`
				Freshness string `json:"freshness"`
				Reported  bool   `json:"reported"`
			} `json:"properties"`
		} `json:"features"`
	}
	r.decode(t, &fc)
	byID := map[string]int{}
	for i, f := range fc.Features {
		byID[f.ID] = i
	}
	f, ok := byID[fresh]
	if fc.Type != "FeatureCollection" || !ok {
		t.Fatalf("map misses station %s", fresh)
	}
	ft := fc.Features[f]
	if ft.Geometry.Type != "Point" || ft.Geometry.Coordinates[0] < 1 || ft.Geometry.Coordinates[0] > 4 || // lng d'abord
		ft.Properties.Status != "approved" || ft.Properties.Freshness != "fresh" || !ft.Properties.Reported {
		t.Fatalf("map feature = %+v", ft)
	}
	if e := fc.Features[byID[expired]].Properties; e.Freshness != "expired" || e.Reported {
		t.Fatalf("expired feature = %+v", e)
	}
	if n := fc.Features[byID[never]].Properties.Freshness; n != "none" {
		t.Fatalf("never-updated station freshness = %q", n)
	}
}

func TestAdminAuditLog(t *testing.T) {
	admin := adminClient(t)
	adminID := adminUserID(t, admin)
	for i, l := range []string{"Gaz audit A", "Gaz audit B"} {
		size := 61.6 + float64(i)*0.7 // 61.6 × 100 n'est pas entier en flottant : doit être accepté
		expect(t, admin.do(http.MethodPost, "/api/v1/admin/products", map[string]any{"kind": "lpg", "sizeKg": size, "label": l}), http.StatusCreated, "")
	}
	type entry struct {
		ID     string `json:"id"`
		Action string `json:"action"`
		Actor  *struct {
			ID   string `json:"id"`
			Role string `json:"role"`
		} `json:"actor"`
		EntityType string `json:"entityType"`
	}
	var page struct {
		Items      []entry `json:"items"`
		NextCursor *string `json:"nextCursor"`
	}
	r := admin.do(http.MethodGet, "/api/v1/admin/audit?actorId="+adminID+"&action=admin.product_created&limit=1", nil)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &page)
	if len(page.Items) != 1 || page.NextCursor == nil || page.Items[0].Actor == nil || page.Items[0].Actor.ID != adminID || page.Items[0].EntityType != "product" {
		t.Fatalf("audit page 1 = %+v", page)
	}
	first := page.Items[0].ID
	admin.do(http.MethodGet, "/api/v1/admin/audit?actorId="+adminID+"&action=admin.product_created&limit=1&cursor="+*page.NextCursor, nil).decode(t, &page)
	if len(page.Items) != 1 || page.Items[0].ID == first {
		t.Fatalf("audit page 2 = %+v", page)
	}
	admin.do(http.MethodGet, "/api/v1/admin/audit?actorId="+adminID+"&action=admin.*", nil).decode(t, &page)
	for _, e := range page.Items {
		if !strings.HasPrefix(e.Action, "admin.") {
			t.Fatalf("prefix filter returned %s", e.Action)
		}
	}
	today := time.Now().In(it.cfg.Timezone).Format(time.DateOnly)
	admin.do(http.MethodGet, "/api/v1/admin/audit?actorId="+adminID+"&entityType=product&from="+today+"&to="+today, nil).decode(t, &page)
	if len(page.Items) < 2 {
		t.Fatalf("today's product entries = %d", len(page.Items))
	}
	admin.do(http.MethodGet, "/api/v1/admin/audit?actorId="+adminID+"&to=2020-01-01", nil).decode(t, &page)
	if len(page.Items) != 0 {
		t.Fatalf("entries before 2020 = %d", len(page.Items))
	}
	expect(t, admin.do(http.MethodGet, "/api/v1/admin/audit?action=DROP%20TABLE", nil), http.StatusUnprocessableEntity, "request.validation_failed")
	expect(t, admin.do(http.MethodGet, "/api/v1/admin/audit?from=hier", nil), http.StatusBadRequest, "request.invalid_parameter")
	expect(t, admin.do(http.MethodGet, "/api/v1/admin/audit?cursor=xyz", nil), http.StatusBadRequest, "request.invalid_parameter")
	// Lecture seule : aucune route d'écriture.
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/audit", map[string]any{}), http.StatusMethodNotAllowed, "method.not_allowed")
}
