package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/handler"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/store/dbgen"
)

func newResponder() *respond.Responder { return respond.New(slog.New(slog.DiscardHandler)) }

func serve(h handler.Func) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	handler.Handle(newResponder(), h).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return body
}

func ok(context.Context) error { return nil }

func TestReadyAllDependenciesUp(t *testing.T) {
	h := handler.NewHealth(newResponder(), slog.New(slog.DiscardHandler), time.Second,
		map[string]handler.Check{"postgres": ok, "redis": ok, "osrm": ok})
	rec := serve(h.Ready)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	body := decode(t, rec)
	checks, _ := body["checks"].(map[string]any)
	if body["status"] != "ready" || checks["postgres"] != "ok" || checks["redis"] != "ok" || checks["osrm"] != "ok" {
		t.Errorf("body = %v", body)
	}
}

func TestReadyDependencyDown(t *testing.T) {
	h := handler.NewHealth(newResponder(), slog.New(slog.DiscardHandler), time.Second, map[string]handler.Check{
		"postgres": ok,
		"osrm":     func(context.Context) error { return errors.New("dial tcp 10.0.0.5:5000: connection refused") },
	})
	rec := serve(h.Ready)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	body := decode(t, rec)
	checks, _ := body["checks"].(map[string]any)
	if body["code"] != apperr.CodeUnavailable || checks["osrm"] != "fail" || checks["postgres"] != "ok" {
		t.Errorf("body = %v", body)
	}
	if strings.Contains(rec.Body.String(), "10.0.0.5") {
		t.Errorf("readiness leaks internal error details: %s", rec.Body.String())
	}
}

func TestReadyCheckTimeout(t *testing.T) {
	hang := func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }
	h := handler.NewHealth(newResponder(), slog.New(slog.DiscardHandler), 20*time.Millisecond,
		map[string]handler.Check{"redis": hang})
	start := time.Now()
	rec := serve(h.Ready)
	if rec.Code != http.StatusServiceUnavailable || time.Since(start) > time.Second {
		t.Fatalf("status = %d after %s", rec.Code, time.Since(start))
	}
}

func TestReadyWhileDraining(t *testing.T) {
	h := handler.NewHealth(newResponder(), slog.New(slog.DiscardHandler), time.Second, map[string]handler.Check{"postgres": ok})
	h.SetDraining()
	if rec := serve(h.Ready); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 while draining", rec.Code)
	}
	if rec := serve(h.Live); rec.Code != http.StatusOK {
		t.Fatalf("liveness = %d, want 200 while draining", rec.Code)
	}
}

type fakeProducts struct {
	rows []dbgen.ListActiveProductsRow
	err  error
}

func (f fakeProducts) ListActiveProducts(context.Context) ([]dbgen.ListActiveProductsRow, error) {
	return f.rows, f.err
}

func TestProductsList(t *testing.T) {
	size := 12.5
	h := handler.NewProducts(newResponder(), fakeProducts{rows: []dbgen.ListActiveProductsRow{
		{ID: 1, Code: "lpg_12_5kg", Kind: dbgen.ProductKindLpg, Unit: dbgen.ProductUnitCylinder, SizeKg: &size, LabelFr: "Gaz 12,5 kg"},
		{ID: 2, Code: "petrol", Kind: dbgen.ProductKindPetrol, Unit: dbgen.ProductUnitLiter, LabelFr: "Essence"},
	}})
	rec := serve(h.List)
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "public, max-age=300" {
		t.Fatalf("got %d %v", rec.Code, rec.Header())
	}
	want := `{"items":[{"id":1,"code":"lpg_12_5kg","kind":"lpg","unit":"cylinder","sizeKg":12.5,"label":"Gaz 12,5 kg"},` +
		`{"id":2,"code":"petrol","kind":"petrol","unit":"liter","sizeKg":null,"label":"Essence"}]}`
	if got := strings.TrimSpace(rec.Body.String()); got != want {
		t.Errorf("body =\n%s\nwant\n%s", got, want)
	}
}

func TestProductsListStoreError(t *testing.T) {
	h := handler.NewProducts(newResponder(), fakeProducts{err: errors.New("connection reset")})
	rec := serve(h.List)
	if rec.Code != http.StatusInternalServerError || decode(t, rec)["code"] != apperr.CodeInternal {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}
