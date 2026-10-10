package middleware_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/auth"
	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/http/middleware"
	"gostation/backend/internal/http/respond"
)

var csrfKey = []byte("0123456789abcdef0123456789abcdef")

type fakeSessions map[string]bool

func (f fakeSessions) Exists(_ context.Context, sid string) (bool, error) {
	if sid == "redis-down" {
		return false, errors.New("redis down")
	}
	return f[sid], nil
}

func newAuthenticator(t *testing.T) (*middleware.Authenticator, *auth.TokenManager) {
	t.Helper()
	keys, err := auth.ParseSigningKeys("k1:" + strings.Repeat("42", 32))
	if err != nil {
		t.Fatal(err)
	}
	tm := auth.NewTokenManager(keys, "gostation-api", "gostation", 15*time.Minute)
	sessions := fakeSessions{"alive": true, "admin-sess": true, "redis-down": true}
	return middleware.NewAuthenticator(tm, sessions, csrfKey, "__Host-gs_at", respond.New(discardLogger())), tm
}

func echoPrincipal() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := httpctx.PrincipalFrom(r.Context())
		if !ok {
			w.WriteHeader(http.StatusTeapot)
			return
		}
		_, _ = w.Write([]byte(p.Role + "|" + p.SessionID))
	})
}

func TestAuthenticatorRequire(t *testing.T) {
	a, tm := newAuthenticator(t)
	uid := uuid.New()
	alive, _ := tm.Issue(uid, "user", "alive", false)
	revoked, _ := tm.Issue(uid, "user", "revoked", false)
	down, _ := tm.Issue(uid, "user", "redis-down", false)
	admin, _ := tm.Issue(uid, "admin", "admin-sess", true)

	tests := []struct {
		name   string
		setup  func(r *http.Request)
		method string
		status int
		code   string
	}{
		{"no credentials", func(*http.Request) {}, http.MethodGet, http.StatusUnauthorized, apperr.CodeUnauthorized},
		{"malformed header", func(r *http.Request) { r.Header.Set("Authorization", "Token "+alive) }, http.MethodGet, http.StatusUnauthorized, apperr.CodeUnauthorized},
		{"invalid token", func(r *http.Request) { r.Header.Set("Authorization", "Bearer x.y.z") }, http.MethodGet, http.StatusUnauthorized, apperr.CodeUnauthorized},
		{"revoked session", func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+revoked) }, http.MethodGet, http.StatusUnauthorized, apperr.CodeUnauthorized},
		{"session store down", func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+down) }, http.MethodGet, http.StatusServiceUnavailable, apperr.CodeUnavailable},
		{"valid bearer", func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+alive) }, http.MethodPost, http.StatusOK, ""},
		{"cookie GET without CSRF", func(r *http.Request) { r.AddCookie(&http.Cookie{Name: "__Host-gs_at", Value: admin}) }, http.MethodGet, http.StatusOK, ""},
		{"cookie POST without CSRF", func(r *http.Request) { r.AddCookie(&http.Cookie{Name: "__Host-gs_at", Value: admin}) }, http.MethodPost, http.StatusForbidden, auth.CodeCSRFFailed},
		{"cookie POST with wrong CSRF", func(r *http.Request) {
			r.AddCookie(&http.Cookie{Name: "__Host-gs_at", Value: admin})
			r.Header.Set(middleware.HeaderCSRF, auth.CSRFToken(csrfKey, "another-session"))
		}, http.MethodPost, http.StatusForbidden, auth.CodeCSRFFailed},
		{"cookie POST with CSRF", func(r *http.Request) {
			r.AddCookie(&http.Cookie{Name: "__Host-gs_at", Value: admin})
			r.Header.Set(middleware.HeaderCSRF, auth.CSRFToken(csrfKey, "admin-sess"))
		}, http.MethodPost, http.StatusOK, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/api/v1/me", nil)
			tt.setup(req)
			rec := httptest.NewRecorder()
			a.Require(echoPrincipal()).ServeHTTP(rec, req)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tt.status, rec.Body.String())
			}
			if tt.code != "" && problemCode(t, rec) != tt.code {
				t.Errorf("code = %s, want %s", problemCode(t, rec), tt.code)
			}
			if tt.status == http.StatusUnauthorized && rec.Header().Get("WWW-Authenticate") == "" {
				t.Error("401 without WWW-Authenticate")
			}
		})
	}
}

func TestAuthenticatorOptional(t *testing.T) {
	a, tm := newAuthenticator(t)
	tok, _ := tm.Issue(uuid.New(), "user", "alive", false)
	for name, header := range map[string]string{"anonymous": "", "invalid": "Bearer nope", "valid": "Bearer " + tok} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		rec := httptest.NewRecorder()
		a.Optional(echoPrincipal()).ServeHTTP(rec, req)
		want := http.StatusTeapot // pas de principal
		if name == "valid" {
			want = http.StatusOK
		}
		if rec.Code != want || rec.Header().Get("WWW-Authenticate") != "" {
			t.Errorf("%s: status %d (want %d), WWW-Authenticate %q", name, rec.Code, want, rec.Header().Get("WWW-Authenticate"))
		}
	}
}

func withPrincipal(p httpctx.Principal) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	return req.WithContext(httpctx.WithPrincipal(req.Context(), p))
}

func TestRequireRole(t *testing.T) {
	rs := respond.New(discardLogger())
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	tests := []struct {
		name  string
		p     *httpctx.Principal
		roles []string
		want  int
	}{
		{"matching role", &httpctx.Principal{Role: "manager"}, []string{"manager"}, http.StatusOK},
		{"other role", &httpctx.Principal{Role: "user"}, []string{"manager"}, http.StatusForbidden},
		{"admin with 2FA", &httpctx.Principal{Role: "admin", MFA: true}, []string{"admin"}, http.StatusOK},
		{"admin without 2FA", &httpctx.Principal{Role: "admin"}, []string{"admin"}, http.StatusForbidden},
		{"no principal", nil, []string{"user"}, http.StatusForbidden},
	}
	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		if tt.p != nil {
			req = withPrincipal(*tt.p)
		}
		rec := httptest.NewRecorder()
		middleware.RequireRole(rs, tt.roles...)(ok).ServeHTTP(rec, req)
		if rec.Code != tt.want {
			t.Errorf("%s: status %d, want %d", tt.name, rec.Code, tt.want)
		}
	}
}

type verifiedFn func(context.Context, uuid.UUID) (bool, error)

func (f verifiedFn) EmailVerified(ctx context.Context, id uuid.UUID) (bool, error) { return f(ctx, id) }

type stationFn func(context.Context, uuid.UUID) (string, error)

func (f stationFn) ManagerStationStatus(ctx context.Context, id uuid.UUID) (string, error) {
	return f(ctx, id)
}

func TestRequireVerifiedEmailAndApprovedStation(t *testing.T) {
	rs := respond.New(discardLogger())
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	p := httpctx.Principal{UserID: uuid.New(), Role: "manager"}

	for verified, want := range map[bool]int{true: http.StatusOK, false: http.StatusForbidden} {
		rec := httptest.NewRecorder()
		mw := middleware.RequireVerifiedEmail(rs, verifiedFn(func(context.Context, uuid.UUID) (bool, error) { return verified, nil }))
		mw(ok).ServeHTTP(rec, withPrincipal(p))
		if rec.Code != want || (want == http.StatusForbidden && problemCode(t, rec) != auth.CodeEmailNotVerified) {
			t.Errorf("verified=%v: status %d", verified, rec.Code)
		}
	}

	for status, want := range map[string]int{"approved": http.StatusOK, "pending": http.StatusForbidden, "rejected": http.StatusForbidden, "suspended": http.StatusForbidden, "": http.StatusForbidden} {
		rec := httptest.NewRecorder()
		mw := middleware.RequireApprovedStation(rs, stationFn(func(context.Context, uuid.UUID) (string, error) { return status, nil }))
		mw(ok).ServeHTTP(rec, withPrincipal(p))
		if rec.Code != want {
			t.Errorf("station %q: status %d, want %d", status, rec.Code, want)
			continue
		}
		if want == http.StatusForbidden {
			if code := problemCode(t, rec); code != auth.CodeStationNotApproved || !strings.Contains(rec.Body.String(), `"stationStatus":"`+status+`"`) {
				t.Errorf("station %q: body %s", status, rec.Body.String())
			}
		}
	}
}
