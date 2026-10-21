package router_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/handler"
	"gostation/backend/internal/http/middleware"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/http/router"
	"gostation/backend/internal/ratelimit"
	"gostation/backend/internal/store/dbgen"
)

type allowAll struct{}

func (allowAll) Allow(context.Context, string, int, time.Duration) (ratelimit.Result, error) {
	return ratelimit.Result{Allowed: true, Limit: 100, Remaining: 99}, nil
}

type noProducts struct{}

func (noProducts) ListActiveProducts(context.Context) ([]dbgen.ListActiveProductsRow, error) {
	return nil, nil
}

func newTestRouter(origins ...string) http.Handler {
	log := slog.New(slog.DiscardHandler)
	rs := respond.New(log)
	return router.New(router.Config{
		RequestTimeout:     time.Second,
		MaxBodyBytes:       1 << 10,
		CORSAllowedOrigins: origins,
		IPRateLimit:        100,
		IPRateWindow:       time.Minute,
	}, router.Deps{
		Log:        log,
		Responder:  rs,
		Health:     handler.NewHealth(rs, log, time.Second, map[string]handler.Check{}),
		Products:   noProducts{},
		Limiter:    allowAll{},
		ClientKeys: middleware.NewClientKeys([]byte("router-test-key")),
	})
}

func do(h http.Handler, method, path string, header http.Header) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	for k, v := range header {
		req.Header[k] = v
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRoutingErrorsAreProblems(t *testing.T) {
	h := newTestRouter()
	tests := []struct {
		method, path string
		status       int
		code         string
	}{
		{http.MethodGet, "/nope", http.StatusNotFound, apperr.CodeRouteNotFound},
		{http.MethodGet, "/api/v1/nope", http.StatusNotFound, apperr.CodeRouteNotFound},
		{http.MethodPost, "/healthz", http.StatusMethodNotAllowed, apperr.CodeMethodNotAllowed},
		{http.MethodDelete, "/api/v1/products", http.StatusMethodNotAllowed, apperr.CodeMethodNotAllowed},
	}
	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := do(h, tt.method, tt.path, nil)
			var p struct {
				Code      string `json:"code"`
				RequestID string `json:"requestId"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
				t.Fatalf("decode %q: %v", rec.Body.String(), err)
			}
			if rec.Code != tt.status || p.Code != tt.code || rec.Header().Get("Content-Type") != respond.ContentTypeProblem {
				t.Errorf("got %d %s %q", rec.Code, p.Code, rec.Header().Get("Content-Type"))
			}
			if p.RequestID == "" || p.RequestID != rec.Header().Get(middleware.HeaderRequestID) {
				t.Errorf("requestId %q must match header %q", p.RequestID, rec.Header().Get(middleware.HeaderRequestID))
			}
		})
	}
}

func TestHealthzAndAPIPrefix(t *testing.T) {
	h := newTestRouter()
	if rec := do(h, http.MethodGet, "/healthz", nil); rec.Code != http.StatusOK {
		t.Errorf("/healthz = %d", rec.Code)
	}
	rec := do(h, http.MethodGet, "/api/v1/products", nil)
	if rec.Code != http.StatusOK || rec.Header().Get("RateLimit-Limit") != "100" {
		t.Errorf("/api/v1/products = %d %v", rec.Code, rec.Header())
	}
	if rec := do(h, http.MethodGet, "/products", nil); rec.Code != http.StatusNotFound {
		t.Errorf("/products without prefix = %d, want 404", rec.Code)
	}
}

func TestCORS(t *testing.T) {
	h := newTestRouter("http://localhost:5173")
	preflight := http.Header{
		"Origin":                        {"http://localhost:5173"},
		"Access-Control-Request-Method": {http.MethodGet},
	}
	rec := do(h, http.MethodOptions, "/api/v1/products", preflight)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Errorf("allowed origin: Access-Control-Allow-Origin = %q", got)
	}
	rec = do(h, http.MethodGet, "/api/v1/products", http.Header{"Origin": {"https://evil.example"}})
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("foreign origin must not be allowed, got %q", got)
	}
}

// En-têtes de sécurité sur toute réponse : sonde, réponse de l'API, erreur de routage, préflight CORS.
func TestSecurityHeaders(t *testing.T) {
	h := newTestRouter("https://admin.gostation.test")
	want := map[string]string{
		"Strict-Transport-Security":    "max-age=63072000; includeSubDomains",
		"X-Content-Type-Options":       "nosniff",
		"Referrer-Policy":              "no-referrer",
		"Content-Security-Policy":      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
		"X-Frame-Options":              "DENY",
		"Cross-Origin-Resource-Policy": "same-origin",
	}
	preflight := http.Header{
		"Origin":                        {"https://admin.gostation.test"},
		"Access-Control-Request-Method": {http.MethodPost},
	}
	for _, tc := range []struct {
		method, path string
		header       http.Header
	}{
		{http.MethodGet, "/healthz", nil},
		{http.MethodGet, "/api/v1/products", nil},
		{http.MethodGet, "/api/v1/nope", nil},
		{http.MethodOptions, "/api/v1/auth/login", preflight},
	} {
		rec := do(h, tc.method, tc.path, tc.header)
		for k, v := range want {
			if got := rec.Header().Get(k); got != v {
				t.Errorf("%s %s: %s = %q, want %q", tc.method, tc.path, k, got, v)
			}
		}
	}
}
