//go:build integration

package router_test

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/handler"
	"gostation/backend/internal/http/middleware"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/http/router"
	"gostation/backend/internal/platform/osrm"
	"gostation/backend/internal/ratelimit"
	"gostation/backend/internal/store"
	"gostation/backend/internal/testutil"
)

// Dépendances réelles du paquet (PostGIS migré + Redis), démarrées une fois dans TestMain.
var (
	itPool  *pgxpool.Pool
	itRedis *goredis.Client
)

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	ctx := context.Background()
	pool, _, stopPG, err := testutil.StartMigratedPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stopPG()
	url, stopRedis, err := testutil.StartRedis(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stopRedis()
	opts, err := goredis.ParseURL(url)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	itPool, itRedis = pool, goredis.NewClient(opts)
	defer func() { _ = itRedis.Close() }()
	return m.Run()
}

// fakeOSRM simule /nearest ; healthy bascule sa réponse.
func fakeOSRM(t *testing.T) (*httptest.Server, *atomic.Bool) {
	healthy := &atomic.Bool{}
	healthy.Store(true)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if !healthy.Load() {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"code":"InternalError"}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":"Ok","waypoints":[]}`))
	}))
	t.Cleanup(srv.Close)
	return srv, healthy
}

// newStack assemble le routeur exactement comme cmd/api, sur les vraies dépendances.
func newStack(t *testing.T, ipLimit int) (http.Handler, *atomic.Bool) {
	t.Helper()
	testutil.ResetRedis(t, itRedis) // quotas par IP : chaque test part de zéro
	osrmSrv, osrmHealthy := fakeOSRM(t)
	osrmClient, err := osrm.New(osrmSrv.URL, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.DiscardHandler)
	rs := respond.New(log)
	st := store.New(itPool)
	health := handler.NewHealth(rs, log, 2*time.Second, map[string]handler.Check{
		"postgres": st.Ping,
		"redis":    func(ctx context.Context) error { return itRedis.Ping(ctx).Err() },
		"osrm":     osrmClient.Ping,
	})
	h := router.New(router.Config{
		RequestTimeout: 5 * time.Second,
		MaxBodyBytes:   1 << 20,
		IPRateLimit:    ipLimit,
		IPRateWindow:   time.Minute,
	}, router.Deps{
		Log:        log,
		Responder:  rs,
		Health:     health,
		Products:   st,
		Limiter:    ratelimit.New(itRedis, ratelimit.WithPrefix("it:"+t.Name())),
		ClientKeys: middleware.NewClientKeys([]byte("router-integration-test-key")),
	})
	return h, osrmHealthy
}

func get(h http.Handler, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestReadyzWithRealDependencies(t *testing.T) {
	h, osrmHealthy := newStack(t, 100)

	rec := get(h, "/readyz")
	if rec.Code != http.StatusOK {
		t.Fatalf("/readyz = %d %s", rec.Code, rec.Body.String())
	}
	var ready struct {
		Status string            `json:"status"`
		Checks map[string]string `json:"checks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &ready); err != nil {
		t.Fatal(err)
	}
	if ready.Status != "ready" || ready.Checks["postgres"] != "ok" || ready.Checks["redis"] != "ok" || ready.Checks["osrm"] != "ok" {
		t.Errorf("/readyz body = %+v", ready)
	}

	osrmHealthy.Store(false)
	rec = get(h, "/readyz")
	var problem struct {
		Code   string            `json:"code"`
		Checks map[string]string `json:"checks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &problem); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusServiceUnavailable || problem.Code != apperr.CodeUnavailable ||
		problem.Checks["osrm"] != "fail" || problem.Checks["postgres"] != "ok" {
		t.Errorf("/readyz with OSRM down = %d %s", rec.Code, rec.Body.String())
	}
}

func TestProductsEndToEnd(t *testing.T) {
	h, _ := newStack(t, 100)
	rec := get(h, "/api/v1/products")
	if rec.Code != http.StatusOK {
		t.Fatalf("/api/v1/products = %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Items []struct {
			Code string `json:"code"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Items) != 5 || body.Items[0].Code != "lpg_5kg" {
		t.Errorf("items = %+v", body.Items)
	}
	if rec.Header().Get("RateLimit-Remaining") != "99" {
		t.Errorf("RateLimit-Remaining = %q, want 99", rec.Header().Get("RateLimit-Remaining"))
	}
}

func TestIPRateLimitEndToEnd(t *testing.T) {
	h, _ := newStack(t, 2)
	for i := range 2 {
		if rec := get(h, "/api/v1/products"); rec.Code != http.StatusOK {
			t.Fatalf("request %d = %d", i+1, rec.Code)
		}
	}
	rec := get(h, "/api/v1/products")
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("3rd request = %d %v", rec.Code, rec.Header())
	}
	// Les sondes de santé ne sont pas soumises au quota de l'API.
	if rec := get(h, "/healthz"); rec.Code != http.StatusOK {
		t.Errorf("/healthz = %d while API quota is exhausted", rec.Code)
	}
}
