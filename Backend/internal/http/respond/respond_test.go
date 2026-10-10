package respond_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/http/respond"
)

func newResponder() (*respond.Responder, *bytes.Buffer) {
	var logs bytes.Buffer
	return respond.New(slog.New(slog.NewJSONHandler(&logs, nil))), &logs
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	return body
}

func TestErrorRendersProblemJSON(t *testing.T) {
	rs, _ := newResponder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/stations/42?lat=6.37&lng=2.42", nil)
	req = req.WithContext(httpctx.WithRequestID(req.Context(), "req-123"))
	rec := httptest.NewRecorder()

	rs.Error(rec, req, fmt.Errorf("get station: %w", apperr.NotFound("Station not found.")))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != respond.ContentTypeProblem {
		t.Errorf("Content-Type = %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q", cc)
	}
	body := decode(t, rec)
	want := map[string]any{
		"type":      "urn:gostation:problem:resource.not_found",
		"title":     "Not Found",
		"status":    float64(404),
		"detail":    "Station not found.",
		"instance":  "/api/v1/stations/42", // sans la query string (position)
		"code":      "resource.not_found",
		"requestId": "req-123",
	}
	for k, v := range want {
		if body[k] != v {
			t.Errorf("%s = %v, want %v", k, body[k], v)
		}
	}
	if strings.Contains(rec.Body.String(), "6.37") {
		t.Errorf("problem leaks the query string: %s", rec.Body.String())
	}
}

func TestValidationFields(t *testing.T) {
	rs, _ := newResponder()
	rec := httptest.NewRecorder()
	rs.Error(rec, httptest.NewRequest(http.MethodGet, "/x", nil), apperr.Validation(
		apperr.FieldError{Field: "lat", Code: "out_of_range", Message: "must be between -90 and 90"},
	))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	errs, _ := decode(t, rec)["errors"].([]any)
	if len(errs) != 1 || errs[0].(map[string]any)["code"] != "out_of_range" {
		t.Errorf("errors = %v", errs)
	}
}

func TestExtensionsCannotOverrideStandardMembers(t *testing.T) {
	rs, _ := newResponder()
	rec := httptest.NewRecorder()
	err := apperr.Unavailable("down").WithMeta("status", "hijacked").WithMeta("checks", map[string]string{"osrm": "fail"})
	rs.Error(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil), err)
	body := decode(t, rec)
	if body["status"] != float64(503) {
		t.Errorf("status member overridden: %v", body["status"])
	}
	if checks, _ := body["checks"].(map[string]any); checks["osrm"] != "fail" {
		t.Errorf("checks extension = %v", body["checks"])
	}
}

func TestUnexpectedErrorsAreHiddenAndLogged(t *testing.T) {
	rs, logs := newResponder()
	rec := httptest.NewRecorder()
	rs.Error(rec, httptest.NewRequest(http.MethodGet, "/x", nil), errors.New("dial tcp: password=hunter2"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	body := decode(t, rec)
	if body["code"] != apperr.CodeInternal || strings.Contains(rec.Body.String(), "hunter2") {
		t.Errorf("internal error must be generic, got %s", rec.Body.String())
	}
	if !strings.Contains(logs.String(), "request failed") || !strings.Contains(logs.String(), "hunter2") {
		t.Errorf("cause must be logged, logs: %s", logs.String())
	}
}

func TestClassify(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"app error", apperr.Conflict("dup"), http.StatusConflict, apperr.CodeConflict},
		{"body too large", fmt.Errorf("decode: %w", &http.MaxBytesError{Limit: 10}), http.StatusRequestEntityTooLarge, apperr.CodeBodyTooLarge},
		{"deadline", fmt.Errorf("query: %w", context.DeadlineExceeded), http.StatusGatewayTimeout, apperr.CodeTimeout},
		{"unknown", errors.New("boom"), http.StatusInternalServerError, apperr.CodeInternal},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := respond.Classify(tt.err)
			if got.Status != tt.status || got.Code != tt.code {
				t.Errorf("Classify = %d %s, want %d %s", got.Status, got.Code, tt.status, tt.code)
			}
		})
	}
}

func TestClientCanceledWritesNothing(t *testing.T) {
	rs, _ := newResponder()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/x", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	rs.Error(rec, req, fmt.Errorf("query: %w", context.Canceled))
	if rec.Body.Len() != 0 || rec.Header().Get("Content-Type") != "" {
		t.Errorf("expected no response, got %d %q", rec.Code, rec.Body.String())
	}
}

func TestJSON(t *testing.T) {
	rs, _ := newResponder()
	rec := httptest.NewRecorder()
	rs.JSON(rec, httptest.NewRequest(http.MethodGet, "/x", nil), http.StatusCreated, map[string]int{"n": 1})
	if rec.Code != http.StatusCreated || rec.Header().Get("Content-Type") != respond.ContentTypeJSON ||
		strings.TrimSpace(rec.Body.String()) != `{"n":1}` {
		t.Errorf("got %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
}
