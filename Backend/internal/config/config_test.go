package config_test

import (
	"bytes"
	"errors"
	"log/slog"
	"net/netip"
	"strings"
	"testing"
	"time"

	"gostation/backend/internal/config"
)

func env(overrides map[string]string) func(string) string {
	base := map[string]string{
		"DATABASE_URL": "postgres://gostation:s3cret-pg@localhost:5440/gostation?sslmode=disable",
		"REDIS_URL":    "redis://:s3cret-redis@localhost:6390/0",
		"OSRM_URL":     "http://localhost:5000",
	}
	for k, v := range overrides {
		base[k] = v
	}
	return func(k string) string { return base[k] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := config.Load(env(nil))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	checks := []struct {
		name      string
		got, want any
	}{
		{"Env", cfg.Env, config.EnvDevelopment},
		{"Timezone", cfg.Timezone.String(), "Africa/Porto-Novo"},
		{"HTTP.Addr", cfg.HTTP.Addr, ":8080"},
		{"HTTP.RequestTimeout", cfg.HTTP.RequestTimeout, 20 * time.Second},
		{"HTTP.MaxBodyBytes", cfg.HTTP.MaxBodyBytes, int64(1 << 20)},
		{"Log.Format", cfg.Log.Format, "json"},
		{"Log.Level", cfg.Log.Level, slog.LevelInfo},
		{"Postgres.MaxConns", cfg.Postgres.MaxConns, int32(20)},
		{"OSRM.Timeout", cfg.OSRM.Timeout, 800 * time.Millisecond},
		{"RateLimit.IPRequests", cfg.RateLimit.IPRequests, 300},
		{"RateLimit.IPWindow", cfg.RateLimit.IPWindow, time.Minute},
		{"CORS", len(cfg.HTTP.CORSAllowedOrigins), 0},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s = %v, want %v", c.name, c.got, c.want)
		}
	}
}

func TestLoadOverrides(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{
		"APP_ENV":              "production",
		"HTTP_ADDR":            "0.0.0.0:9090",
		"LOG_LEVEL":            "debug",
		"LOG_FORMAT":           "text",
		"HTTP_TRUSTED_PROXIES": " 10.0.0.0/8 , 192.168.1.10 ",
		"CORS_ALLOWED_ORIGINS": "http://localhost:5173, https://admin.gostation.bj/",
		"DATABASE_MAX_CONNS":   "50",
	}))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Env != config.EnvProduction || cfg.HTTP.Addr != "0.0.0.0:9090" || cfg.Log.Level != slog.LevelDebug ||
		cfg.Log.Format != "text" || cfg.Postgres.MaxConns != 50 {
		t.Errorf("unexpected config: %+v", cfg)
	}
	wantProxies := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("192.168.1.10/32")}
	if len(cfg.HTTP.TrustedProxies) != 2 || cfg.HTTP.TrustedProxies[0] != wantProxies[0] || cfg.HTTP.TrustedProxies[1] != wantProxies[1] {
		t.Errorf("TrustedProxies = %v, want %v", cfg.HTTP.TrustedProxies, wantProxies)
	}
	wantOrigins := []string{"http://localhost:5173", "https://admin.gostation.bj"}
	if strings.Join(cfg.HTTP.CORSAllowedOrigins, " ") != strings.Join(wantOrigins, " ") {
		t.Errorf("CORSAllowedOrigins = %v, want %v", cfg.HTTP.CORSAllowedOrigins, wantOrigins)
	}
}

func TestLoadInvalid(t *testing.T) {
	tests := []struct {
		key, value string
	}{
		{"APP_ENV", "prod"},
		{"APP_TIMEZONE", "Mars/Olympus"},
		{"HTTP_ADDR", "8080"},
		{"HTTP_ADDR", ":99999"},
		{"HTTP_READ_TIMEOUT", "15"},
		{"HTTP_REQUEST_TIMEOUT", "-1s"},
		{"HTTP_MAX_BODY_BYTES", "0"},
		{"HTTP_TRUSTED_PROXIES", "10.0.0.0/33"},
		{"CORS_ALLOWED_ORIGINS", "*"},
		{"CORS_ALLOWED_ORIGINS", "https://admin.gostation.bj/path"},
		{"LOG_LEVEL", "verbose"},
		{"LOG_FORMAT", "xml"},
		{"DATABASE_URL", ""},
		{"DATABASE_URL", "mysql://u:p@localhost/db"},
		{"DATABASE_MAX_CONNS", "0"},
		{"REDIS_URL", "http://localhost:6390"},
		{"OSRM_URL", "not a url"},
		{"OSRM_TIMEOUT", "fast"},
		{"RATE_LIMIT_IP_REQUESTS", "-5"},
		{"RATE_LIMIT_IP_WINDOW", "500ms"},
	}
	for _, tt := range tests {
		t.Run(tt.key+"="+tt.value, func(t *testing.T) {
			_, err := config.Load(env(map[string]string{tt.key: tt.value}))
			var verr *config.ValidationError
			if !errors.As(err, &verr) {
				t.Fatalf("Load error = %v, want *ValidationError", err)
			}
			if !strings.Contains(err.Error(), tt.key+":") {
				t.Errorf("error %q does not name %s", err, tt.key)
			}
		})
	}
}

func TestLoadReportsAllProblemsAtOnce(t *testing.T) {
	_, err := config.Load(func(string) string { return "" })
	var verr *config.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("Load error = %v, want *ValidationError", err)
	}
	for _, key := range []string{"DATABASE_URL", "REDIS_URL", "OSRM_URL"} {
		if !strings.Contains(err.Error(), key+": is required") {
			t.Errorf("error does not report %s:\n%s", key, err)
		}
	}
}

func TestRequestTimeoutMustBeBelowWriteTimeout(t *testing.T) {
	_, err := config.Load(env(map[string]string{"HTTP_REQUEST_TIMEOUT": "30s", "HTTP_WRITE_TIMEOUT": "30s"}))
	if err == nil || !strings.Contains(err.Error(), "HTTP_REQUEST_TIMEOUT") {
		t.Fatalf("Load error = %v, want HTTP_REQUEST_TIMEOUT problem", err)
	}
}

func TestSecretsNeverLeak(t *testing.T) {
	_, err := config.Load(env(map[string]string{"DATABASE_URL": "mysql://user:hunter2@db/x"}))
	if err == nil || strings.Contains(err.Error(), "hunter2") {
		t.Fatalf("error leaks the password: %v", err)
	}

	cfg, err := config.Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	slog.New(slog.NewJSONHandler(&buf, nil)).Info("cfg", slog.Any("config", cfg))
	if out := buf.String(); strings.Contains(out, "s3cret") || !strings.Contains(out, `"http_addr":":8080"`) {
		t.Fatalf("LogValue must hide secrets and keep safe fields, got %s", out)
	}
}
