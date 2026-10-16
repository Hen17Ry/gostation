//go:build integration

package app_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"gostation/backend/internal/app"
	"gostation/backend/internal/config"
	"gostation/backend/internal/http/middleware"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/platform/osrm"
	"gostation/backend/internal/platform/storage"
	"gostation/backend/internal/store/dbgen"
	"gostation/backend/internal/testutil"
)

// Environnement partagé par les tests du paquet : PostGIS migré, Redis et Mailpit réels,
// application assemblée exactement comme cmd/api, et worker asynq dans le même processus (emails,
// push vers un faux Expo, alertes), sans scheduler : les tâches périodiques sont appelées
// directement par les tests.
var it struct {
	handler http.Handler
	svc     *app.Services
	pool    *pgxpool.Pool
	rdb     *goredis.Client
	mailpit *testutil.Mailpit
	cfg     config.Config
	osrm    *fakeOSRM
	expo    *fakeExpo
	clock   *testClock
	mailer  *flakyMailer
	logs    *logBuffer
	docs    storage.Storage
}

const password = "Lagune-Cotonou-88"

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func runTests(m *testing.M) (code int) {
	ctx := context.Background()
	fail := func(err error) int { fmt.Fprintln(os.Stderr, err); return 1 }

	pool, dsn, stopPG, err := testutil.StartMigratedPostgres(ctx)
	if err != nil {
		return fail(err)
	}
	defer stopPG()
	redisURL, stopRedis, err := testutil.StartRedis(ctx)
	if err != nil {
		return fail(err)
	}
	defer stopRedis()
	mp, stopMailpit, err := testutil.StartMailpit(ctx)
	if err != nil {
		return fail(err)
	}
	defer stopMailpit()

	fake := &fakeOSRM{delay: 2 * time.Second}
	osrmSrv := httptest.NewServer(fake)
	defer osrmSrv.Close()
	expo := newFakeExpo()
	expoSrv := httptest.NewServer(expo)
	defer expoSrv.Close()

	env := map[string]string{
		"DATABASE_URL": dsn, "REDIS_URL": redisURL, "OSRM_URL": osrmSrv.URL, "OSRM_TIMEOUT": "300ms",
		"JWT_SIGNING_KEYS": "it-key:" + randomHex(32), "APP_SECRET": randomHex(32),
		"DOCUMENTS_ENCRYPTION_KEY": randomHex(32), "SMTP_HOST": mp.SMTPHost, "SMTP_PORT": fmt.Sprint(mp.SMTPPort),
		"EXPO_ACCESS_TOKEN": "it-expo-token", "EXPO_PUSH_URL": expoSrv.URL, "PUSH_RECEIPTS_DELAY": "300ms",
		"JOBS_RETRY_BASE_DELAY": "100ms", "JOBS_RETRY_MAX_DELAY": "400ms",
	}
	cfg, err := config.Load(func(k string) string { return env[k] })
	if err != nil {
		return fail(err)
	}
	opts, err := goredis.ParseURL(redisURL)
	if err != nil {
		return fail(err)
	}
	rdb := goredis.NewClient(opts)
	defer func() { _ = rdb.Close() }()
	smtp, err := mail.NewSMTP(mail.SMTPConfig{Host: mp.SMTPHost, Port: mp.SMTPPort, From: cfg.SMTP.From, TLSMode: mail.TLSNone})
	if err != nil {
		return fail(err)
	}
	dir, err := os.MkdirTemp("", "gostation-docs-*")
	if err != nil {
		return fail(err)
	}
	defer func() { _ = os.RemoveAll(dir) }()
	docs, err := storage.NewLocal(dir)
	if err != nil {
		return fail(err)
	}
	// Tous les logs (debug compris) sont capturés ; WARN et ERROR sont affichés en cas d'échec.
	logs := &logBuffer{}
	log := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	defer func() {
		if code != 0 {
			fmt.Fprintln(os.Stderr, "── application warnings and errors ──\n"+logs.problems())
		}
	}()
	osrmClient, err := osrm.New(osrmSrv.URL, cfg.OSRM.Timeout)
	if err != nil {
		return fail(err)
	}
	clock := &testClock{}
	mailer := &flakyMailer{next: smtp, failures: map[string]int{}, attempts: map[string]int{}}
	infra := app.Infra{Pool: pool, Redis: rdb, Mailer: mailer, Storage: docs, OSRM: osrmClient, Clock: clock.Now}
	svc, err := app.NewServices(cfg, infra, log)
	if err != nil {
		return fail(err)
	}
	handler, _ := app.NewHandler(cfg, svc, rdb, log)
	w, err := app.NewWorker(cfg, svc, infra, log, app.WorkerOptions{
		DisableScheduler: true, PollInterval: 20 * time.Millisecond, DelayedCheckInterval: 50 * time.Millisecond,
	})
	if err != nil {
		return fail(err)
	}
	if err := w.Start(); err != nil {
		return fail(err)
	}
	defer w.Shutdown()

	it.handler, it.svc, it.pool, it.rdb, it.mailpit, it.cfg = handler, svc, pool, rdb, mp, cfg
	it.osrm, it.expo, it.clock, it.mailer, it.logs, it.docs = fake, expo, clock, mailer, logs, docs
	return m.Run()
}

// client simule un appareil : une IP propre (quotas isolés entre tests), un bearer token,
// ou les cookies et le jeton CSRF de l'admin web.
type client struct {
	t       *testing.T
	ip      string
	bearer  string
	cookies map[string]*http.Cookie
	csrf    string
	// handler remplace l'application partagée (ex. configuration modifiée) ; nil : it.handler.
	handler http.Handler
}

func newClient(t *testing.T) *client {
	t.Helper()
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	return &client{t: t, ip: fmt.Sprintf("10.%d.%d.%d", b[0], b[1], b[2]), cookies: map[string]*http.Cookie{}}
}

type response struct {
	*httptest.ResponseRecorder
}

func (r response) decode(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Body.Bytes(), v); err != nil {
		t.Fatalf("decode %q: %v", r.Body.String(), err)
	}
}

// code renvoie le code stable d'une réponse problem+json ("" sinon).
func (r response) code() string {
	var p struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(r.Body.Bytes(), &p)
	return p.Code
}

func (c *client) send(req *http.Request) response {
	req.RemoteAddr = c.ip + ":5555"
	req.Header.Set("User-Agent", "GoStation-Test/1.0")
	if c.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	for _, ck := range c.cookies {
		req.AddCookie(ck)
	}
	if c.csrf != "" && req.Method != http.MethodGet {
		req.Header.Set(middleware.HeaderCSRF, c.csrf)
	}
	rec := httptest.NewRecorder()
	h := it.handler
	if c.handler != nil {
		h = c.handler
	}
	h.ServeHTTP(rec, req)
	for _, ck := range rec.Result().Cookies() {
		if ck.MaxAge < 0 {
			delete(c.cookies, ck.Name)
		} else {
			c.cookies[ck.Name] = ck
		}
	}
	return response{rec}
}

func (c *client) do(method, path string, body any) response {
	c.t.Helper()
	var r io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			c.t.Fatal(err)
		}
		r = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return c.send(req)
}

// doIf envoie une écriture avec l'en-tête If-Match (verrouillage optimiste).
func (c *client) doIf(method, path, etag string, body any) response {
	c.t.Helper()
	var r io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			c.t.Fatal(err)
		}
		r = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if etag != "" {
		req.Header.Set("If-Match", etag)
	}
	return c.send(req)
}

func (c *client) multipart(path string, fields map[string]string, filename string, file []byte) response {
	c.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	if file != nil {
		fw, err := w.CreateFormFile("document", filename)
		if err != nil {
			c.t.Fatal(err)
		}
		_, _ = fw.Write(file)
	}
	_ = w.Close()
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	return c.send(req)
}

func expect(t *testing.T, r response, status int, code string) {
	t.Helper()
	if r.Code != status || (code != "" && r.code() != code) {
		t.Fatalf("got %d %s, want %d %s — body: %s", r.Code, r.code(), status, code, r.Body.String())
	}
}

func uniqueEmail(prefix string) string {
	return prefix + "." + strings.ReplaceAll(uuid.NewString()[:13], "-", "") + "@example.bj"
}

type session struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int    `json:"expiresIn"`
	User         struct {
		ID            string `json:"id"`
		Role          string `json:"role"`
		EmailVerified bool   `json:"emailVerified"`
		Station       *struct {
			ID           string  `json:"id"`
			Status       string  `json:"status"`
			StatusReason *string `json:"statusReason"`
		} `json:"station"`
	} `json:"user"`
}

func registerUser(t *testing.T, c *client, email string) session {
	t.Helper()
	r := c.do(http.MethodPost, "/api/v1/auth/register", map[string]string{
		"firstName": "Afi", "lastName": "Dossou", "email": email, "password": password, "privacyPolicyVersion": "1.0",
	})
	expect(t, r, http.StatusCreated, "")
	var s session
	r.decode(t, &s)
	return s
}

func latestCode(t *testing.T, email, subject string) string {
	t.Helper()
	msg, err := it.mailpit.WaitFor(t.Context(), email, subject)
	if err != nil {
		t.Fatal(err)
	}
	code, err := msg.Code()
	if err != nil {
		t.Fatal(err)
	}
	return code
}

func login(t *testing.T, c *client, email, pw string) session {
	t.Helper()
	r := c.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": pw})
	expect(t, r, http.StatusOK, "")
	var s session
	r.decode(t, &s)
	return s
}

func auditActions(t *testing.T, entityType, entityID string) []string {
	t.Helper()
	rows, err := it.svc.Store.ListAuditLogsByEntity(t.Context(), entityTypeParams(entityType, entityID))
	if err != nil {
		t.Fatal(err)
	}
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.Action)
	}
	return out
}

func entityTypeParams(typ, id string) dbgen.ListAuditLogsByEntityParams {
	return dbgen.ListAuditLogsByEntityParams{EntityType: typ, EntityID: &id}
}

func contains(list []string, want ...string) bool {
	set := map[string]bool{}
	for _, v := range list {
		set[v] = true
	}
	for _, w := range want {
		if !set[w] {
			return false
		}
	}
	return true
}
