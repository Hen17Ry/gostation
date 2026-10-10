package router_test

import (
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"go.yaml.in/yaml/v3"

	"gostation/backend/internal/http/handler"
	"gostation/backend/internal/http/middleware"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/http/router"
)

// TestRoutesMatchOpenAPISpec garantit que Backend/api/openapi.yaml décrit exactement les
// routes servies : les clients génèrent leurs types depuis la spec, elle ne doit pas dériver.
func TestRoutesMatchOpenAPISpec(t *testing.T) {
	raw, err := os.ReadFile("../../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		OpenAPI string                    `yaml:"openapi"`
		Paths   map[string]map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(spec.OpenAPI, "3.1") {
		t.Fatalf("openapi version = %q, want 3.1.x", spec.OpenAPI)
	}
	var documented []string
	for path, ops := range spec.Paths {
		for method := range ops {
			switch method {
			case "get", "post", "put", "patch", "delete":
				documented = append(documented, strings.ToUpper(method)+" "+path)
			}
		}
	}

	// Routeur complet : les handlers sont construits sans services (seule la table de routage compte).
	log := slog.New(slog.DiscardHandler)
	rs := respond.New(log)
	authHandler := handler.NewAuth(rs, nil, allowAll{}, handler.Cookies{Secure: true}, nil, nil, log)
	h := router.New(router.Config{
		RequestTimeout: time.Second, MaxBodyBytes: 1 << 10, DocumentBodyBytes: 1 << 10,
		IPRateLimit: 1, IPRateWindow: time.Minute,
	}, router.Deps{
		Log: log, Responder: rs, Health: handler.NewHealth(rs, log, time.Second, nil), Products: noProducts{},
		Limiter: allowAll{}, Authenticator: middleware.NewAuthenticator(nil, nil, nil, "gs_at", rs),
		Auth: authHandler, Me: handler.NewMe(rs, nil, authHandler), Stations: handler.NewStations(rs, nil),
	})
	var served []string
	err = chi.Walk(h.(chi.Routes), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		served = append(served, method+" "+strings.TrimSuffix(route, "/"))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	slices.Sort(documented)
	slices.Sort(served)
	for _, r := range served {
		if !slices.Contains(documented, r) {
			t.Errorf("route served but missing from openapi.yaml: %s", r)
		}
	}
	for _, r := range documented {
		if !slices.Contains(served, r) {
			t.Errorf("route documented in openapi.yaml but not served: %s", r)
		}
	}
	if len(served) < 25 {
		t.Errorf("only %d routes walked, the router is probably incomplete", len(served))
	}
}
