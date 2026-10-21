package handler_test

import (
	"context"
	"errors"
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
	"gostation/backend/internal/ratelimit"
)

type downLimiter struct{}

func (downLimiter) Allow(context.Context, string, int, time.Duration) (ratelimit.Result, error) {
	return ratelimit.Result{}, errors.New("redis down")
}

// Redis en panne : la connexion échoue fermée (503) au lieu de laisser essayer des mots de passe
// sans limite (ASVS 2.2.1). Le service n'est jamais appelé.
func TestLoginFailsClosedWithoutLimiter(t *testing.T) {
	log := slog.New(slog.DiscardHandler)
	rs := newResponder()
	h := handler.NewAuth(rs, nil, downLimiter{}, middleware.NewClientKeys([]byte("k")), handler.Cookies{Secure: true}, nil, []byte("e"), log)
	for _, tc := range []struct {
		path string
		fn   handler.Func
	}{
		{"/api/v1/auth/login", h.Login},
		{"/api/v1/auth/admin/login", h.AdminLogin},
	} {
		req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(`{"email":"a@b.bj","password":"x"}`))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(httpctx.WithClientIP(req.Context(), netip.MustParseAddr("203.0.113.5")))
		rec := httptest.NewRecorder()
		handler.Handle(rs, tc.fn).ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable || decode(t, rec)["code"] != apperr.CodeUnavailable {
			t.Errorf("%s: %d %s, want 503 %s", tc.path, rec.Code, rec.Body.String(), apperr.CodeUnavailable)
		}
	}
}
