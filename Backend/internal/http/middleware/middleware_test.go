package middleware_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/handler"
	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/http/middleware"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/ratelimit"
)

func discardLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

func problemCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != respond.ContentTypeProblem {
		t.Fatalf("Content-Type = %q, want problem+json (body %q)", ct, rec.Body.String())
	}
	var p struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode problem: %v", err)
	}
	return p.Code
}

func TestRequestID(t *testing.T) {
	var seen string
	h := middleware.RequestID(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = httpctx.RequestID(r.Context())
	}))
	tests := []struct {
		name, incoming string
		keep           bool
	}{
		{"valid id is kept", "mobile-1729.abc:42", true},
		{"missing id is generated", "", false},
		{"unsafe id is replaced", "id with spaces\n", false},
		{"too long id is replaced", strings.Repeat("a", 65), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.incoming != "" {
				req.Header.Set(middleware.HeaderRequestID, tt.incoming)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			got := rec.Header().Get(middleware.HeaderRequestID)
			if got != seen {
				t.Errorf("header %q != context %q", got, seen)
			}
			if tt.keep && got != tt.incoming {
				t.Errorf("id = %q, want %q", got, tt.incoming)
			}
			if !tt.keep && (len(got) != 36 || got[14] != '7') {
				t.Errorf("id = %q, want a generated UUIDv7", got)
			}
		})
	}
}

func TestRealIP(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}
	tests := []struct {
		name, remote, xff, want string
	}{
		{"untrusted peer ignores X-Forwarded-For", "203.0.113.9:4000", "1.2.3.4", "203.0.113.9"},
		{"trusted proxy: rightmost untrusted hop", "10.0.0.1:4000", "198.51.100.1, 203.0.113.7, 10.0.0.2", "203.0.113.7"},
		{"only trusted hops: leftmost", "10.0.0.1:4000", "10.1.1.1, 10.0.0.2", "10.1.1.1"},
		{"malformed hop stops the walk", "10.0.0.1:4000", "203.0.113.7, garbage", "10.0.0.1"},
		{"trusted proxy without header", "10.0.0.1:4000", "", "10.0.0.1"},
		{"IPv4-mapped IPv6 peer", "[::ffff:203.0.113.9]:4000", "", "203.0.113.9"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got netip.Addr
			h := middleware.RealIP(trusted)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				got, _ = httpctx.ClientIP(r.Context())
			}))
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tt.remote
			if tt.xff != "" {
				req.Header.Set("X-Forwarded-For", tt.xff)
			}
			h.ServeHTTP(httptest.NewRecorder(), req)
			if got.String() != tt.want {
				t.Errorf("client IP = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestRecover(t *testing.T) {
	rs := respond.New(discardLogger())
	h := middleware.Recover(discardLogger(), rs)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("nil map")
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusInternalServerError || problemCode(t, rec) != apperr.CodeInternal {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}

func TestRecoverRepanicsOnErrAbortHandler(t *testing.T) {
	rs := respond.New(discardLogger())
	h := middleware.Recover(discardLogger(), rs)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	}))
	defer func() {
		if rec := recover(); rec != http.ErrAbortHandler { //nolint:errorlint // valeur de panic, pas une erreur enveloppée
			t.Fatalf("recovered %v, want http.ErrAbortHandler", rec)
		}
	}()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
}

func TestMaxBodyBytes(t *testing.T) {
	rs := respond.New(discardLogger())
	read := handler.Handle(rs, func(w http.ResponseWriter, r *http.Request) error {
		if _, err := io.ReadAll(r.Body); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	})
	h := middleware.MaxBodyBytes(8, rs)(read)

	t.Run("declared length over the limit is rejected upfront", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader("0123456789")))
		if rec.Code != http.StatusRequestEntityTooLarge || problemCode(t, rec) != apperr.CodeBodyTooLarge {
			t.Fatalf("got %d %s", rec.Code, rec.Body.String())
		}
	})
	t.Run("streamed body over the limit fails on read", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", io.NopCloser(strings.NewReader("0123456789")))
		req.ContentLength = -1
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusRequestEntityTooLarge || problemCode(t, rec) != apperr.CodeBodyTooLarge {
			t.Fatalf("got %d %s", rec.Code, rec.Body.String())
		}
	})
	t.Run("small body passes", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader("tiny")))
		if rec.Code != http.StatusNoContent {
			t.Fatalf("got %d", rec.Code)
		}
	})
}

func TestTimeoutRendersGatewayTimeout(t *testing.T) {
	rs := respond.New(discardLogger())
	slow := handler.Handle(rs, func(_ http.ResponseWriter, r *http.Request) error {
		<-r.Context().Done()
		return r.Context().Err()
	})
	rec := httptest.NewRecorder()
	middleware.Timeout(10*time.Millisecond)(slow).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusGatewayTimeout || problemCode(t, rec) != apperr.CodeTimeout {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}

type fakeLimiter struct {
	res   ratelimit.Result
	err   error
	calls int
	key   string
}

func (f *fakeLimiter) Allow(_ context.Context, key string, _ int, _ time.Duration) (ratelimit.Result, error) {
	f.calls++
	f.key = key
	return f.res, f.err
}

func TestRateLimit(t *testing.T) {
	rs := respond.New(discardLogger())
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	policy := middleware.RateLimitPolicy{Name: "ip", Limit: 10, Window: time.Minute, Key: middleware.ByClientIP}
	withIP := func() *http.Request {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		return req.WithContext(httpctx.WithClientIP(req.Context(), netip.MustParseAddr("203.0.113.9")))
	}

	t.Run("allowed request carries quota headers", func(t *testing.T) {
		l := &fakeLimiter{res: ratelimit.Result{Allowed: true, Limit: 10, Remaining: 7, Reset: 1500 * time.Millisecond}}
		rec := httptest.NewRecorder()
		middleware.RateLimit(l, policy, discardLogger(), rs)(ok).ServeHTTP(rec, withIP())
		if rec.Code != http.StatusOK || rec.Header().Get("RateLimit-Remaining") != "7" || rec.Header().Get("RateLimit-Reset") != "2" {
			t.Fatalf("got %d %v", rec.Code, rec.Header())
		}
		if !strings.HasPrefix(l.key, "ip:") || strings.Contains(l.key, "203.0.113.9") {
			t.Errorf("limiter key %q must be a hash of the IP", l.key)
		}
	})
	t.Run("denied request gets 429 and Retry-After", func(t *testing.T) {
		l := &fakeLimiter{res: ratelimit.Result{Allowed: false, Limit: 10, RetryAfter: 30 * time.Second, Reset: 30 * time.Second}}
		rec := httptest.NewRecorder()
		middleware.RateLimit(l, policy, discardLogger(), rs)(ok).ServeHTTP(rec, withIP())
		if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "30" || problemCode(t, rec) != apperr.CodeRateLimited {
			t.Fatalf("got %d %v %s", rec.Code, rec.Header(), rec.Body.String())
		}
	})
	t.Run("limiter failure fails open", func(t *testing.T) {
		l := &fakeLimiter{err: errors.New("redis down")}
		rec := httptest.NewRecorder()
		middleware.RateLimit(l, policy, discardLogger(), rs)(ok).ServeHTTP(rec, withIP())
		if rec.Code != http.StatusOK {
			t.Fatalf("got %d, want 200 (fail open)", rec.Code)
		}
	})
	t.Run("request without client IP is not limited", func(t *testing.T) {
		l := &fakeLimiter{}
		rec := httptest.NewRecorder()
		middleware.RateLimit(l, policy, discardLogger(), rs)(ok).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if rec.Code != http.StatusOK || l.calls != 0 {
			t.Fatalf("got %d, calls %d", rec.Code, l.calls)
		}
	})
}

func TestAccessLogNeverLogsQueryString(t *testing.T) {
	var logs bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&logs, nil))
	h := middleware.AccessLog(log)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/search?lat=6.3703&lng=2.4253", nil))
	out := logs.String()
	if !strings.Contains(out, `"status":418`) || !strings.Contains(out, `"path":"/api/v1/search"`) {
		t.Errorf("access log incomplete: %s", out)
	}
	if strings.Contains(out, "6.3703") {
		t.Errorf("access log leaks the position: %s", out)
	}
}
