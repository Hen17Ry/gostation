//go:build integration

package app_test

import (
	"bytes"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/auth"
	"gostation/backend/internal/document"
)

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func managerFields(email string) map[string]string {
	return map[string]string{
		"firstName": "Kofi", "lastName": "Mensah", "email": email, "password": password, "privacyPolicyVersion": "1.0",
		"stationName": "Station Akpakpa", "brand": "Indépendant", "ifu": "3201234567890", "rccm": "RB/COT/24 B 12345",
		"address": "Carrefour Akpakpa, Cotonou", "city": "Cotonou", "phone": "+229 01 90 00 00 00",
	}
}

// jpegWithGPS renvoie une photo de justificatif portant des métadonnées EXIF (position GPS).
func jpegWithGPS(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 16, 16))
	img.Set(3, 3, color.RGBA{R: 0xF9, G: 0x73, B: 0x16, A: 0xFF})
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	raw := buf.Bytes()
	payload := []byte("Exif\x00\x00GPSLatitude=6.3601;GPSLongitude=2.4498")
	seg := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2)) //nolint:gosec // charge utile de test
	out := append([]byte{}, raw[:2]...)
	out = append(out, append(seg, payload...)...)
	return append(out, raw[2:]...)
}

func registerManager(t *testing.T, c *client, email string, file []byte, filename string) session {
	t.Helper()
	r := c.multipart("/api/v1/auth/register/manager", managerFields(email), filename, file)
	expect(t, r, http.StatusCreated, "")
	var s session
	r.decode(t, &s)
	return s
}

func TestManagerPendingIsBlocked(t *testing.T) {
	c := newClient(t)
	s := registerManager(t, c, uniqueEmail("kofi"), []byte("%PDF-1.7 attestation IFU"), "ifu.pdf")
	if s.User.Role != "manager" || s.User.Station == nil || s.User.Station.Status != "pending" {
		t.Fatalf("manager registration = %+v", s.User)
	}
	c.bearer = s.AccessToken

	r := c.do(http.MethodGet, "/api/v1/manager/station", nil)
	expect(t, r, http.StatusForbidden, auth.CodeStationNotApproved)
	if !strings.Contains(r.Body.String(), `"stationStatus":"pending"`) {
		t.Errorf("problem must carry the station status: %s", r.Body.String())
	}

	// Rejet : le gérant voit le statut et le motif via /me, toujours rien d'autre.
	if _, err := it.pool.Exec(t.Context(), `UPDATE stations SET status = 'rejected', status_reason = 'Justificatif illisible' WHERE id = $1`, s.User.Station.ID); err != nil {
		t.Fatal(err)
	}
	var me session
	c.do(http.MethodGet, "/api/v1/me", nil).decode(t, &me.User)
	if me.User.Station.Status != "rejected" || me.User.Station.StatusReason == nil || *me.User.Station.StatusReason != "Justificatif illisible" {
		t.Fatalf("/me station = %+v", me.User.Station)
	}
	expect(t, c.do(http.MethodGet, "/api/v1/manager/station", nil), http.StatusForbidden, auth.CodeStationNotApproved)

	// Approbation : l'accès est ouvert immédiatement (statut lu en base à chaque requête).
	if _, err := it.pool.Exec(t.Context(), `UPDATE stations SET status = 'approved', status_reason = NULL WHERE id = $1`, s.User.Station.ID); err != nil {
		t.Fatal(err)
	}
	r = c.do(http.MethodGet, "/api/v1/manager/station", nil)
	expect(t, r, http.StatusOK, "")
	var st struct {
		Name     string `json:"name"`
		Phone    string `json:"phone"`
		RCCM     string `json:"rccm"`
		Location any    `json:"location"`
	}
	r.decode(t, &st)
	if st.Name != "Station Akpakpa" || st.Phone != "+2290190000000" || st.RCCM != "RB/COT/24 B 12345" || st.Location != nil {
		t.Errorf("station = %+v", st)
	}

	// Un utilisateur simple n'accède pas à l'espace gérant.
	u := newClient(t)
	u.bearer = registerUser(t, u, uniqueEmail("notmanager")).AccessToken
	expect(t, u.do(http.MethodGet, "/api/v1/manager/station", nil), http.StatusForbidden, apperr.CodeForbidden)
}

func TestManagerUploadRejected(t *testing.T) {
	email := uniqueEmail("upload")
	tests := []struct {
		name     string
		file     []byte
		filename string
		status   int
		code     string
	}{
		{"gif disguised as pdf", []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"), "ifu.pdf", http.StatusUnsupportedMediaType, document.CodeUnsupportedType},
		{"text file", []byte("just some text, not a document"), "ifu.png", http.StatusUnsupportedMediaType, document.CodeUnsupportedType},
		{"too large", append([]byte("%PDF-1.7 "), make([]byte, 5<<20)...), "big.pdf", http.StatusRequestEntityTooLarge, document.CodeTooLarge},
		{"missing document", nil, "", http.StatusUnprocessableEntity, apperr.CodeValidation},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newClient(t).multipart("/api/v1/auth/register/manager", managerFields(email), tt.filename, tt.file)
			expect(t, r, tt.status, tt.code)
		})
	}
	// Aucun compte n'a été créé par les tentatives refusées : l'email est libre.
	registerManager(t, newClient(t), email, []byte("%PDF-1.4 ok"), "ok.pdf")

	r := newClient(t).multipart("/api/v1/auth/register/manager", map[string]string{"email": uniqueEmail("x"), "isAdmin": "true"}, "", nil)
	expect(t, r, http.StatusUnprocessableEntity, apperr.CodeValidation)
}

type adminChallenge struct {
	MFAToken  string `json:"mfaToken"`
	TwoFactor string `json:"twoFactor"`
	Setup     *struct {
		Secret     string `json:"secret"`
		OTPAuthURI string `json:"otpauthUri"`
	} `json:"setup"`
}

type adminSession struct {
	CSRFToken     string   `json:"csrfToken"`
	RecoveryCodes []string `json:"recoveryCodes"`
	User          struct {
		Role             string `json:"role"`
		TwoFactorEnabled bool   `json:"twoFactorEnabled"`
	} `json:"user"`
}

func adminLogin(t *testing.T, c *client, email string) adminChallenge {
	t.Helper()
	r := c.do(http.MethodPost, "/api/v1/auth/admin/login", map[string]string{"email": email, "password": password})
	expect(t, r, http.StatusOK, "")
	var ch adminChallenge
	r.decode(t, &ch)
	return ch
}

func totp(t *testing.T, secretB32 string, at time.Time) string {
	t.Helper()
	secret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secretB32)
	if err != nil {
		t.Fatal(err)
	}
	return auth.TOTPCode(secret, at)
}

func TestAdminTwoFactorJourney(t *testing.T) {
	email := uniqueEmail("ada")
	adminID, err := it.svc.Auth.CreateAdmin(t.Context(), email, "Ada", "Admin", password)
	if err != nil {
		t.Fatal(err)
	}

	// Un gérant dépose une photo de justificatif avec des métadonnées GPS.
	mgr := registerManager(t, newClient(t), uniqueEmail("kofi-doc"), jpegWithGPS(t), "photo.jpg")

	// 1. Mot de passe : aucun cookie, aucune session, seulement un défi 2FA (mise en place).
	web := newClient(t)
	ch := adminLogin(t, web, email)
	if ch.TwoFactor != "setup_required" || ch.Setup == nil || !strings.HasPrefix(ch.Setup.OTPAuthURI, "otpauth://totp/GoStation:") {
		t.Fatalf("challenge = %+v", ch)
	}
	if len(web.cookies) != 0 {
		t.Fatalf("cookies set before 2FA: %v", web.cookies)
	}
	web.bearer = ch.MFAToken
	expect(t, web.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, apperr.CodeUnauthorized)
	web.bearer = ""

	// 2. Mauvais code refusé, bon code : session ouverte (cookies), 10 codes de secours.
	expect(t, web.do(http.MethodPost, "/api/v1/auth/admin/2fa", map[string]string{"mfaToken": ch.MFAToken, "code": "000000"}),
		http.StatusUnauthorized, auth.CodeInvalidSecondFactor)
	now := time.Now()
	r := web.do(http.MethodPost, "/api/v1/auth/admin/2fa", map[string]string{"mfaToken": ch.MFAToken, "code": totp(t, ch.Setup.Secret, now)})
	expect(t, r, http.StatusOK, "")
	var sess adminSession
	r.decode(t, &sess)
	if len(sess.RecoveryCodes) != 10 || sess.CSRFToken == "" || !sess.User.TwoFactorEnabled || sess.User.Role != "admin" {
		t.Fatalf("admin session = %+v", sess)
	}
	at, rt := web.cookies["__Host-gs_at"], web.cookies["__Secure-gs_rt"]
	if at == nil || rt == nil || !at.HttpOnly || !at.Secure || at.SameSite != http.SameSiteStrictMode || rt.Path != "/api/v1/auth" {
		t.Fatalf("session cookies = %+v / %+v", at, rt)
	}
	if web.cookies["gs_csrf"] == nil || web.cookies["gs_csrf"].HttpOnly {
		t.Fatal("the CSRF cookie must be readable by the admin web app")
	}

	// 3. Cookie : GET autorisé ; POST exige le jeton CSRF.
	expect(t, web.do(http.MethodGet, "/api/v1/me", nil), http.StatusOK, "")
	expect(t, web.do(http.MethodPost, "/api/v1/me/accept-privacy-policy", map[string]string{"version": "1.0"}), http.StatusForbidden, auth.CodeCSRFFailed)
	web.csrf = sess.CSRFToken
	expect(t, web.do(http.MethodPost, "/api/v1/me/accept-privacy-policy", map[string]string{"version": "1.0"}), http.StatusOK, "")

	// 4. Lecture du justificatif : déchiffré, métadonnées retirées, téléchargement forcé, audité.
	r = web.do(http.MethodGet, "/api/v1/admin/stations/"+mgr.User.Station.ID+"/document", nil)
	expect(t, r, http.StatusOK, "")
	if r.Header().Get("Content-Type") != "image/jpeg" || !strings.HasPrefix(r.Header().Get("Content-Disposition"), "attachment;") ||
		r.Header().Get("Cache-Control") != "no-store" || r.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("document headers = %v", r.Header())
	}
	if bytes.Contains(r.Body.Bytes(), []byte("GPS")) {
		t.Error("EXIF metadata leaked in the stored document")
	}
	if _, err := jpeg.Decode(bytes.NewReader(r.Body.Bytes())); err != nil {
		t.Errorf("served document is not a valid JPEG: %v", err)
	}
	if !contains(auditActions(t, "station", mgr.User.Station.ID), "admin.document_viewed", "manager.registered") {
		t.Error("document access not audited")
	}
	expect(t, web.do(http.MethodGet, "/api/v1/admin/stations/"+uuid.NewString()+"/document", nil), http.StatusNotFound, apperr.CodeNotFound)

	// Le gérant, lui, n'y a pas accès.
	m := newClient(t)
	m.bearer = mgr.AccessToken
	expect(t, m.do(http.MethodGet, "/api/v1/admin/stations/"+mgr.User.Station.ID+"/document", nil), http.StatusForbidden, apperr.CodeForbidden)

	// 5. Refresh par cookie : CSRF obligatoire, puis rotation.
	noCSRF := &client{t: t, ip: web.ip, cookies: web.cookies}
	expect(t, noCSRF.do(http.MethodPost, "/api/v1/auth/refresh", nil), http.StatusForbidden, auth.CodeCSRFFailed)
	oldRT := web.cookies["__Secure-gs_rt"].Value
	expect(t, web.do(http.MethodPost, "/api/v1/auth/refresh", nil), http.StatusOK, "")
	if web.cookies["__Secure-gs_rt"].Value == oldRT {
		t.Fatal("refresh cookie not rotated")
	}

	// 6. Nouveau login : le même code TOTP ne peut pas resservir (anti-rejeu) ; le pas suivant passe.
	again := newClient(t)
	ch2 := adminLogin(t, again, email)
	if ch2.TwoFactor != "required" || ch2.Setup != nil {
		t.Fatalf("second challenge = %+v", ch2)
	}
	expect(t, again.do(http.MethodPost, "/api/v1/auth/admin/2fa", map[string]string{"mfaToken": ch2.MFAToken, "code": totp(t, ch.Setup.Secret, now)}),
		http.StatusUnauthorized, auth.CodeInvalidSecondFactor)
	expect(t, again.do(http.MethodPost, "/api/v1/auth/admin/2fa", map[string]string{"mfaToken": ch2.MFAToken, "code": totp(t, ch.Setup.Secret, now.Add(30*time.Second))}),
		http.StatusOK, "")

	// 7. Code de secours : utilisable une seule fois.
	rec := newClient(t)
	ch3 := adminLogin(t, rec, email)
	expect(t, rec.do(http.MethodPost, "/api/v1/auth/admin/2fa", map[string]string{"mfaToken": ch3.MFAToken, "recoveryCode": strings.ToLower(sess.RecoveryCodes[0])}),
		http.StatusOK, "")
	ch4 := adminLogin(t, newClient(t), email)
	expect(t, rec.do(http.MethodPost, "/api/v1/auth/admin/2fa", map[string]string{"mfaToken": ch4.MFAToken, "recoveryCode": sess.RecoveryCodes[0]}),
		http.StatusUnauthorized, auth.CodeInvalidSecondFactor)

	// 8. Logout par cookie : cookies effacés, session révoquée.
	expect(t, web.do(http.MethodPost, "/api/v1/auth/logout", nil), http.StatusNoContent, "")
	if len(web.cookies) != 0 {
		t.Errorf("cookies left after logout: %v", web.cookies)
	}

	actions := auditActions(t, "user", adminID.String())
	if !contains(actions, "admin.created", "auth.2fa_enabled", "auth.admin_login_succeeded", "auth.2fa_failed", "auth.recovery_code_used") {
		t.Errorf("admin audit = %v", actions)
	}
}

// Un admin sans 2FA n'obtient aucune session ; un token admin sans claim mfa est refusé.
func TestAdminWithoutTwoFactorIsBlocked(t *testing.T) {
	email := uniqueEmail("no2fa")
	adminID, err := it.svc.Auth.CreateAdmin(t.Context(), email, "Ada", "Admin", password)
	if err != nil {
		t.Fatal(err)
	}
	c := newClient(t)
	ch := adminLogin(t, c, email)
	if ch.MFAToken == "" || len(c.cookies) != 0 {
		t.Fatalf("password step must only return a 2FA challenge: %+v %v", ch, c.cookies)
	}
	expect(t, c.do(http.MethodGet, "/api/v1/admin/stations/"+uuid.NewString()+"/document", nil), http.StatusUnauthorized, apperr.CodeUnauthorized)

	sess, _, err := it.svc.Sessions.Create(t.Context(), auth.Session{UserID: adminID, Role: "admin", Client: auth.ClientWeb}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	c.bearer, err = it.svc.Tokens.Issue(adminID, "admin", sess.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	expect(t, c.do(http.MethodGet, "/api/v1/admin/stations/"+uuid.NewString()+"/document", nil), http.StatusForbidden, apperr.CodeForbidden)

	// Défi 2FA épuisé après 5 codes faux.
	for range auth.MFAMaxAttempts {
		c.do(http.MethodPost, "/api/v1/auth/admin/2fa", map[string]string{"mfaToken": ch.MFAToken, "code": "123456"})
	}
	expect(t, c.do(http.MethodPost, "/api/v1/auth/admin/2fa", map[string]string{"mfaToken": ch.MFAToken, "code": totp(t, ch.Setup.Secret, time.Now())}),
		http.StatusUnauthorized, auth.CodeInvalidMFAToken)

	// Un compte non admin n'ouvre pas de défi.
	user := uniqueEmail("plain")
	registerUser(t, newClient(t), user)
	expect(t, newClient(t).do(http.MethodPost, "/api/v1/auth/admin/login", map[string]string{"email": user, "password": password}),
		http.StatusUnauthorized, auth.CodeInvalidCredentials)
}

func TestResetAdmin2FA(t *testing.T) {
	email := uniqueEmail("reset2fa")
	if _, err := it.svc.Auth.CreateAdmin(t.Context(), email, "Ada", "Admin", password); err != nil {
		t.Fatal(err)
	}
	web := newClient(t)
	ch := adminLogin(t, web, email)
	expect(t, web.do(http.MethodPost, "/api/v1/auth/admin/2fa", map[string]string{"mfaToken": ch.MFAToken, "code": totp(t, ch.Setup.Secret, time.Now())}), http.StatusOK, "")

	if _, err := it.svc.Auth.ResetAdmin2FA(t.Context(), email); err != nil {
		t.Fatal(err)
	}
	expect(t, web.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, "")
	if again := adminLogin(t, newClient(t), email); again.TwoFactor != "setup_required" {
		t.Fatalf("after reset, 2FA must be set up again: %+v", again)
	}
}

// La suppression du compte d'un gérant suspend sa station.
func TestManagerDeletionSuspendsStation(t *testing.T) {
	c := newClient(t)
	s := registerManager(t, c, uniqueEmail("leaving"), []byte("%PDF-1.4"), "ifu.pdf")
	c.bearer = s.AccessToken
	expect(t, c.do(http.MethodDelete, "/api/v1/me", map[string]string{"password": password}), http.StatusNoContent, "")
	var status string
	if err := it.pool.QueryRow(t.Context(), `SELECT status FROM stations WHERE id = $1`, s.User.Station.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "suspended" {
		t.Errorf("station status = %s, want suspended", status)
	}
}
