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
		"DATABASE_URL":             "postgres://gostation:s3cret-pg@localhost:5440/gostation?sslmode=disable",
		"REDIS_URL":                "redis://:s3cret-redis@localhost:6390/0",
		"OSRM_URL":                 "http://localhost:5000",
		"JWT_SIGNING_KEYS":         "k2:" + strings.Repeat("ab", 32) + ",k1:" + strings.Repeat("cd", 32),
		"APP_SECRET":               strings.Repeat("ef", 32),
		"RATE_LIMIT_KEY":           strings.Repeat("ab", 32),
		"DOCUMENTS_ENCRYPTION_KEY": strings.Repeat("01", 32),
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
		{"RateLimit.IPRequests", cfg.RateLimit.IPRequests, 1200},
		{"Search.RateLimitIP", cfg.Search.RateLimitIP, 300},
		{"Search.RateLimitClient", cfg.Search.RateLimitClient, 30},
		{"Search.MinResults", cfg.Search.MinResults, 3},
		{"Search.CacheTTL", cfg.Search.CacheTTL, time.Minute},
		{"RateLimit.IPWindow", cfg.RateLimit.IPWindow, time.Minute},
		{"CORS", len(cfg.HTTP.CORSAllowedOrigins), 0},
		{"Auth.SigningKeys", len(cfg.Auth.SigningKeys), 2},
		{"Auth.SigningKeys[0].ID", cfg.Auth.SigningKeys[0].ID, "k2"},
		{"Auth.AccessTTL", cfg.Auth.AccessTTL, 15 * time.Minute},
		{"Auth.RefreshTTL", cfg.Auth.RefreshTTL, 720 * time.Hour},
		{"Auth.AdminRefreshTTL", cfg.Auth.AdminRefreshTTL, 12 * time.Hour},
		{"Auth.AppSecret", len(cfg.Auth.AppSecret), 32},
		{"Auth.PrivacyPolicyVersion", cfg.Auth.PrivacyPolicyVersion, "1.0"},
		{"Auth.CookieSecure", cfg.Auth.CookieSecure, true},
		{"Documents.MaxBytes", cfg.Documents.MaxBytes, int64(5 << 20)},
		{"SMTP.Port", cfg.SMTP.Port, 1025},
		{"SMTP.TLSMode", cfg.SMTP.TLSMode, "none"},
		{"Jobs.Concurrency", cfg.Jobs.Concurrency, 10},
		{"Jobs.RetryBaseDelay", cfg.Jobs.RetryBaseDelay, 10 * time.Second},
		{"Jobs.RetryMaxDelay", cfg.Jobs.RetryMaxDelay, time.Hour},
		{"Jobs.HealthAddr", cfg.Jobs.HealthAddr, ":8081"},
		{"Push.ExpoAccessToken", cfg.Push.ExpoAccessToken, ""},
		{"Push.ExpoURL", cfg.Push.ExpoURL, "https://exp.host"},
		{"Push.ReceiptsDelay", cfg.Push.ReceiptsDelay, 15 * time.Minute},
		{"Reminders.Interval", cfg.Reminders.Interval, 4 * time.Hour},
		{"Retention.Notifications", cfg.Retention.Notifications, 30 * 24 * time.Hour},
		{"Retention.BackInStockAlerts", cfg.Retention.BackInStockAlerts, 30 * 24 * time.Hour},
		{"Retention.DeviceTokens", cfg.Retention.DeviceTokens, 90 * 24 * time.Hour},
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
		"SMTP_TLS":             "starttls",
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
		{"JWT_SIGNING_KEYS", ""},
		{"JWT_SIGNING_KEYS", "nokid"},
		{"JWT_SIGNING_KEYS", "k1:abcd"},
		{"JWT_SIGNING_KEYS", "k1:" + strings.Repeat("ab", 32) + ",k1:" + strings.Repeat("cd", 32)},
		{"APP_SECRET", "tooshort"},
		{"RATE_LIMIT_KEY", "tooshort"},
		{"APP_SECRET", strings.Repeat("zz", 32)},
		{"DOCUMENTS_ENCRYPTION_KEY", strings.Repeat("ab", 16)},
		{"COOKIE_SECURE", "maybe"},
		{"SMTP_TLS", "ssl"},
		{"SMTP_PORT", "0"},
		{"DOCUMENTS_MAX_BYTES", "10"},
		{"WORKER_CONCURRENCY", "0"},
		{"WORKER_HEALTH_ADDR", "8081"},
		{"JOBS_RETRY_MAX_DELAY", "1s"},
		{"EXPO_PUSH_URL", "ftp://exp.host"},
		{"PUSH_RECEIPTS_DELAY", "soon"},
		{"STOCK_REMINDER_INTERVAL", "0s"},
		{"RETENTION_NOTIFICATIONS", "30d"},
		{"RETENTION_DEVICE_TOKENS", "30m"},
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

func TestProductionRules(t *testing.T) {
	_, err := config.Load(env(map[string]string{"APP_ENV": "production", "COOKIE_SECURE": "false"}))
	if err == nil || !strings.Contains(err.Error(), "SMTP_TLS:") || !strings.Contains(err.Error(), "COOKIE_SECURE:") {
		t.Fatalf("production must require SMTP TLS and secure cookies, got %v", err)
	}
	if _, err := config.Load(env(map[string]string{"APP_ENV": "production", "SMTP_TLS": "tls"})); err != nil {
		t.Fatalf("valid production config rejected: %v", err)
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
	badKey := "k1:" + strings.Repeat("9f", 31) // 31 octets : invalide
	_, err = config.Load(env(map[string]string{"JWT_SIGNING_KEYS": badKey, "APP_SECRET": "deadbeef"}))
	if err == nil || strings.Contains(err.Error(), strings.Repeat("9f", 31)) || strings.Contains(err.Error(), "deadbeef") {
		t.Fatalf("error leaks key material: %v", err)
	}

	cfg, err := config.Load(env(map[string]string{"EXPO_ACCESS_TOKEN": "expo-s3cret-token"}))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	slog.New(slog.NewJSONHandler(&buf, nil)).Info("cfg", slog.Any("config", cfg))
	if out := buf.String(); strings.Contains(out, "s3cret") || strings.Contains(out, strings.Repeat("ef", 32)) ||
		!strings.Contains(out, `"http_addr":":8080"`) || !strings.Contains(out, `"expo_push":true`) {
		t.Fatalf("LogValue must hide secrets and keep safe fields, got %s", out)
	}
}

func TestStorageDriver(t *testing.T) {
	cfg, err := config.Load(env(nil))
	if err != nil || cfg.Documents.Storage.Driver != "local" {
		t.Fatalf("default storage = %q, %v; want local", cfg.Documents.Storage.Driver, err)
	}
	_, err = config.Load(env(map[string]string{"STORAGE_DRIVER": "s3", "S3_ENDPOINT": "https://s3.example.com"}))
	for _, key := range []string{"S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT"} {
		if err == nil || !strings.Contains(err.Error(), key+":") {
			t.Errorf("incomplete S3 config must report %s, got %v", key, err)
		}
	}
	s3 := map[string]string{
		"STORAGE_DRIVER": "s3", "S3_ENDPOINT": "s3.fr-par.scw.cloud", "S3_REGION": "fr-par", "S3_BUCKET": "gostation",
		"S3_ACCESS_KEY_ID": "key", "S3_SECRET_ACCESS_KEY": "secret", "S3_PREFIX": "prod",
	}
	cfg, err = config.Load(env(s3))
	if err != nil {
		t.Fatal(err)
	}
	if st := cfg.Documents.Storage; !st.S3TLS || st.S3PathStyle || st.S3Bucket != "gostation" || st.S3Prefix != "prod" {
		t.Errorf("s3 storage = %+v", st)
	}
	s3["APP_ENV"], s3["SMTP_TLS"], s3["S3_TLS"] = "production", "tls", "false"
	if _, err := config.Load(env(s3)); err == nil || !strings.Contains(err.Error(), "S3_TLS:") {
		t.Fatalf("production must require S3 TLS, got %v", err)
	}
	if _, err := config.Load(env(map[string]string{"STORAGE_DRIVER": "ftp"})); err == nil {
		t.Fatal("unknown storage driver accepted")
	}
}
