// Package config charge la configuration depuis l'environnement, une seule fois au démarrage.
// Toutes les valeurs invalides sont signalées ensemble, avec le nom de la variable en cause.
// La source de vérité des variables est .env.example à la racine du dépôt.
package config

import (
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Env est l'environnement d'exécution.
type Env string

// Environnements reconnus.
const (
	EnvDevelopment Env = "development"
	EnvStaging     Env = "staging"
	EnvProduction  Env = "production"
)

// Config est la configuration complète de l'API. Elle contient des secrets (URLs de
// connexion) : ne jamais la journaliser telle quelle (LogValue en donne une vue sûre).
type Config struct {
	Env       Env
	Timezone  *time.Location
	HTTP      HTTP
	Log       Log
	Postgres  Postgres
	Redis     Redis
	OSRM      OSRM
	RateLimit RateLimit
	Auth      Auth
	Documents Documents
	SMTP      SMTP
	Stock     Stock
	Search    Search
	Jobs      Jobs
	Push      Push
	Reminders Reminders
}

// Jobs regroupe les réglages du worker asynq (cmd/worker).
type Jobs struct {
	Concurrency     int
	ShutdownTimeout time.Duration
	// Backoff exponentiel des retries : RetryBaseDelay × 2^n (± 25 %), plafonné à RetryMaxDelay.
	RetryBaseDelay time.Duration
	RetryMaxDelay  time.Duration
	// HealthAddr : sondes /healthz et /readyz du worker (healthcheck Docker).
	HealthAddr string
}

// Push regroupe les réglages des notifications push (Expo Push API).
type Push struct {
	// ExpoAccessToken est facultatif : vide, les push passent par le Pusher factice (journal).
	ExpoAccessToken string
	ExpoURL         string
	Timeout         time.Duration
	// ReceiptsDelay : délai avant la lecture des reçus Expo (DeviceNotRegistered).
	ReceiptsDelay time.Duration
}

// Reminders regroupe les réglages des rappels de mise à jour des stocks.
type Reminders struct {
	// Interval : délai depuis la dernière mise à jour (ou le dernier rappel) avant un rappel.
	Interval time.Duration
}

// Search regroupe les réglages de la recherche (ARCHITECTURE §4).
type Search struct {
	CacheTTL      time.Duration
	MinResults    int
	MaxCandidates int
	// Quotas : par IP, et par installation (X-Install-Id) ou utilisateur connecté (D22).
	RateLimitIP     int
	RateLimitClient int
	// StatsFlushInterval : vidage des compteurs Redis de stats vers search_stats.
	StatsFlushInterval time.Duration
}

// Stock regroupe les plafonds de saisie et les seuils de fraîcheur des stocks (D16).
type Stock struct {
	MaxCylinders int
	MaxLiters    int
	// StaleAfter : au-delà, le résultat porte le flag stale ; ExpiredAfter : exclu de la recherche.
	StaleAfter   time.Duration
	ExpiredAfter time.Duration
}

// HTTP regroupe les paramètres du serveur HTTP.
type HTTP struct {
	Addr               string
	ReadTimeout        time.Duration
	WriteTimeout       time.Duration
	IdleTimeout        time.Duration
	RequestTimeout     time.Duration
	ShutdownTimeout    time.Duration
	MaxBodyBytes       int64
	TrustedProxies     []netip.Prefix
	CORSAllowedOrigins []string
}

// Log regroupe les paramètres de journalisation.
type Log struct {
	Level  slog.Level
	Format string
}

// Postgres regroupe les paramètres de connexion PostgreSQL.
type Postgres struct {
	URL      string
	MaxConns int32
}

// Redis regroupe les paramètres de connexion Redis.
type Redis struct {
	URL string
}

// OSRM regroupe les paramètres du client de routage.
type OSRM struct {
	URL     string
	Timeout time.Duration
}

// RateLimit regroupe les quotas globaux.
type RateLimit struct {
	IPRequests int
	IPWindow   time.Duration
}

// SigningKey est une clé de signature Ed25519 des access tokens (graine de 32 octets).
type SigningKey struct {
	ID   string
	Seed []byte
}

// Auth regroupe les réglages d'authentification.
type Auth struct {
	// SigningKeys : la première signe, toutes vérifient (rotation par kid).
	SigningKeys     []SigningKey
	Issuer          string
	Audience        string
	AccessTTL       time.Duration
	RefreshTTL      time.Duration
	AdminRefreshTTL time.Duration
	// AppSecret est le secret maître des dérivations HKDF (HMAC des codes, CSRF, secrets TOTP…).
	AppSecret            []byte
	PrivacyPolicyVersion string
	CookieSecure         bool
}

// Documents regroupe les réglages des justificatifs IFU.
type Documents struct {
	EncryptionKey []byte
	StorageDir    string
	MaxBytes      int64
}

// SMTP regroupe les réglages d'envoi des emails.
type SMTP struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	TLSMode  string
}

// ValidationError liste toutes les variables invalides.
type ValidationError struct {
	Problems []string
}

func (e *ValidationError) Error() string {
	return "invalid configuration:\n  - " + strings.Join(e.Problems, "\n  - ")
}

// Load lit et valide la configuration. getenv est os.Getenv en production, une map en test.
func Load(getenv func(string) string) (Config, error) {
	l := &loader{getenv: getenv}
	var c Config

	c.Env = Env(l.oneOf("APP_ENV", string(EnvDevelopment),
		string(EnvDevelopment), string(EnvStaging), string(EnvProduction)))
	c.Timezone = l.location("APP_TIMEZONE", "Africa/Porto-Novo")

	c.HTTP = HTTP{
		Addr:               l.addr("HTTP_ADDR", ":8080"),
		ReadTimeout:        l.duration("HTTP_READ_TIMEOUT", 15*time.Second),
		WriteTimeout:       l.duration("HTTP_WRITE_TIMEOUT", 30*time.Second),
		IdleTimeout:        l.duration("HTTP_IDLE_TIMEOUT", 120*time.Second),
		RequestTimeout:     l.duration("HTTP_REQUEST_TIMEOUT", 20*time.Second),
		ShutdownTimeout:    l.duration("HTTP_SHUTDOWN_TIMEOUT", 20*time.Second),
		MaxBodyBytes:       int64(l.integer("HTTP_MAX_BODY_BYTES", 1<<20, 1, 64<<20)),
		TrustedProxies:     l.prefixes("HTTP_TRUSTED_PROXIES"),
		CORSAllowedOrigins: l.origins("CORS_ALLOWED_ORIGINS"),
	}
	if c.HTTP.RequestTimeout >= c.HTTP.WriteTimeout {
		l.fail("HTTP_REQUEST_TIMEOUT", "must be lower than HTTP_WRITE_TIMEOUT (%s), otherwise the timeout error cannot be written", c.HTTP.WriteTimeout)
	}

	c.Log = Log{
		Level:  l.level("LOG_LEVEL", slog.LevelInfo),
		Format: l.oneOf("LOG_FORMAT", "json", "json", "text"),
	}

	c.Postgres = Postgres{
		URL:      l.url("DATABASE_URL", "postgres", "postgresql"),
		MaxConns: int32(l.integer("DATABASE_MAX_CONNS", 20, 1, 1000)), //nolint:gosec // borné à 1000 ci-dessus
	}
	c.Redis = Redis{URL: l.url("REDIS_URL", "redis", "rediss")}
	c.OSRM = OSRM{
		URL:     l.url("OSRM_URL", "http", "https"),
		Timeout: l.duration("OSRM_TIMEOUT", 800*time.Millisecond),
	}
	c.RateLimit = RateLimit{
		IPRequests: l.integer("RATE_LIMIT_IP_REQUESTS", 1200, 1, 1_000_000),
		IPWindow:   l.duration("RATE_LIMIT_IP_WINDOW", time.Minute),
	}
	if c.RateLimit.IPWindow < time.Second {
		l.fail("RATE_LIMIT_IP_WINDOW", "must be at least 1s")
	}

	c.Auth = Auth{
		SigningKeys:          l.signingKeys("JWT_SIGNING_KEYS"),
		Issuer:               l.str("JWT_ISSUER", "gostation-api"),
		Audience:             l.str("JWT_AUDIENCE", "gostation"),
		AccessTTL:            l.duration("JWT_ACCESS_TTL", 15*time.Minute),
		RefreshTTL:           l.duration("JWT_REFRESH_TTL", 30*24*time.Hour),
		AdminRefreshTTL:      l.duration("ADMIN_REFRESH_TTL", 12*time.Hour),
		AppSecret:            l.hexKey("APP_SECRET", 32, 64),
		PrivacyPolicyVersion: l.str("PRIVACY_POLICY_VERSION", "1.0"),
		CookieSecure:         l.boolean("COOKIE_SECURE", true),
	}
	c.Documents = Documents{
		EncryptionKey: l.hexKey("DOCUMENTS_ENCRYPTION_KEY", 32, 32),
		StorageDir:    l.str("DOCUMENTS_STORAGE_DIR", "./var/documents"),
		MaxBytes:      int64(l.integer("DOCUMENTS_MAX_BYTES", 5<<20, 1024, 20<<20)),
	}
	c.SMTP = SMTP{
		Host:     l.str("SMTP_HOST", "localhost"),
		Port:     l.integer("SMTP_PORT", 1025, 1, 65535),
		Username: l.raw("SMTP_USERNAME"),
		Password: l.raw("SMTP_PASSWORD"),
		From:     l.str("SMTP_FROM", "GoStation <no-reply@gostation.local>"),
		TLSMode:  l.oneOf("SMTP_TLS", "none", "none", "starttls", "tls"),
	}
	c.Stock = Stock{
		MaxCylinders: l.integer("STOCK_MAX_CYLINDERS", 10_000, 1, 1_000_000),
		MaxLiters:    l.integer("STOCK_MAX_LITERS", 200_000, 1, 10_000_000),
		StaleAfter:   l.duration("STOCK_STALE_AFTER", 8*time.Hour),
		ExpiredAfter: l.duration("STOCK_EXPIRED_AFTER", 24*time.Hour),
	}
	c.Search = Search{
		CacheTTL:           l.duration("SEARCH_CACHE_TTL", time.Minute),
		MinResults:         l.integer("SEARCH_MIN_RESULTS", 3, 1, 20),
		MaxCandidates:      l.integer("SEARCH_MAX_CANDIDATES", 20, 5, 100),
		RateLimitIP:        l.integer("SEARCH_RATE_LIMIT_IP", 300, 1, 10_000_000),
		RateLimitClient:    l.integer("SEARCH_RATE_LIMIT_CLIENT", 30, 1, 10_000_000),
		StatsFlushInterval: l.duration("STATS_FLUSH_INTERVAL", 5*time.Minute),
	}
	c.Jobs = Jobs{
		Concurrency:     l.integer("WORKER_CONCURRENCY", 10, 1, 500),
		ShutdownTimeout: l.duration("WORKER_SHUTDOWN_TIMEOUT", 25*time.Second),
		RetryBaseDelay:  l.duration("JOBS_RETRY_BASE_DELAY", 10*time.Second),
		RetryMaxDelay:   l.duration("JOBS_RETRY_MAX_DELAY", time.Hour),
		HealthAddr:      l.addr("WORKER_HEALTH_ADDR", ":8081"),
	}
	if c.Jobs.RetryMaxDelay < c.Jobs.RetryBaseDelay {
		l.fail("JOBS_RETRY_MAX_DELAY", "must not be lower than JOBS_RETRY_BASE_DELAY (%s)", c.Jobs.RetryBaseDelay)
	}
	c.Push = Push{
		ExpoAccessToken: l.raw("EXPO_ACCESS_TOKEN"),
		ExpoURL:         l.optionalURL("EXPO_PUSH_URL", "https://exp.host", "http", "https"),
		Timeout:         l.duration("EXPO_PUSH_TIMEOUT", 15*time.Second),
		ReceiptsDelay:   l.duration("PUSH_RECEIPTS_DELAY", 15*time.Minute),
	}
	c.Reminders = Reminders{Interval: l.duration("STOCK_REMINDER_INTERVAL", 4*time.Hour)}

	if c.Search.MinResults > c.Search.MaxCandidates {
		l.fail("SEARCH_MIN_RESULTS", "must not exceed SEARCH_MAX_CANDIDATES (%d)", c.Search.MaxCandidates)
	}
	if c.Stock.ExpiredAfter <= c.Stock.StaleAfter {
		l.fail("STOCK_EXPIRED_AFTER", "must be greater than STOCK_STALE_AFTER (%s)", c.Stock.StaleAfter)
	}

	if c.Env == EnvProduction {
		if c.SMTP.TLSMode == "none" {
			l.fail("SMTP_TLS", "must be starttls or tls in production")
		}
		if !c.Auth.CookieSecure {
			l.fail("COOKIE_SECURE", "must be true in production")
		}
	}

	if len(l.problems) > 0 {
		return Config{}, &ValidationError{Problems: l.problems}
	}
	return c, nil
}

// LogValue donne une vue de la configuration sans aucun secret.
func (c Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("env", string(c.Env)),
		slog.String("http_addr", c.HTTP.Addr),
		slog.String("log_level", c.Log.Level.String()),
		slog.Int("db_max_conns", int(c.Postgres.MaxConns)),
		slog.String("osrm_timeout", c.OSRM.Timeout.String()),
		slog.Int("cors_origins", len(c.HTTP.CORSAllowedOrigins)),
		slog.Int("trusted_proxies", len(c.HTTP.TrustedProxies)),
		slog.Int("signing_keys", len(c.Auth.SigningKeys)),
		slog.String("smtp", fmt.Sprintf("%s:%d (%s)", c.SMTP.Host, c.SMTP.Port, c.SMTP.TLSMode)),
		slog.Bool("cookie_secure", c.Auth.CookieSecure),
		slog.Bool("expo_push", c.Push.ExpoAccessToken != ""),
		slog.Int("worker_concurrency", c.Jobs.Concurrency),
	)
}

// loader lit les variables et accumule les problèmes au lieu de s'arrêter au premier.
type loader struct {
	getenv   func(string) string
	problems []string
}

func (l *loader) fail(key, format string, args ...any) {
	l.problems = append(l.problems, key+": "+fmt.Sprintf(format, args...))
}

func (l *loader) raw(key string) string {
	return strings.TrimSpace(l.getenv(key))
}

func (l *loader) str(key, def string) string {
	if v := l.raw(key); v != "" {
		return v
	}
	return def
}

func (l *loader) boolean(key string, def bool) bool {
	switch l.raw(key) {
	case "":
		return def
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	default:
		l.fail(key, "must be true or false")
		return def
	}
}

// hexKey lit une clé obligatoire encodée en hexadécimal, de minBytes à maxBytes octets.
// Le message d'erreur ne reprend jamais la valeur.
func (l *loader) hexKey(key string, minBytes, maxBytes int) []byte {
	v := l.raw(key)
	if v == "" {
		l.fail(key, "is required (generate one with: openssl rand -hex %d)", minBytes)
		return nil
	}
	b, err := hex.DecodeString(v)
	if err != nil || len(b) < minBytes || len(b) > maxBytes {
		if minBytes == maxBytes {
			l.fail(key, "must be %d bytes encoded in hex (%d characters)", minBytes, 2*minBytes)
		} else {
			l.fail(key, "must be %d to %d bytes encoded in hex", minBytes, maxBytes)
		}
		return nil
	}
	return b
}

// signingKeys lit « kid:graine_hex[,kid:graine_hex…] » (graines Ed25519 de 32 octets).
func (l *loader) signingKeys(key string) []SigningKey {
	items := l.list(key)
	if len(items) == 0 {
		l.fail(key, "is required (format kid:hexseed, seed from: openssl rand -hex 32)")
		return nil
	}
	var out []SigningKey
	seen := map[string]bool{}
	for i, item := range items {
		kid, seedHex, ok := strings.Cut(item, ":")
		seed, err := hex.DecodeString(seedHex)
		if !ok || kid == "" || seen[kid] || err != nil || len(seed) != 32 {
			l.fail(key, "entry %d must be kid:hexseed with a unique kid and a 32-byte hex seed", i+1)
			continue
		}
		seen[kid] = true
		out = append(out, SigningKey{ID: kid, Seed: seed})
	}
	return out
}

func (l *loader) oneOf(key, def string, allowed ...string) string {
	v := l.raw(key)
	if v == "" {
		return def
	}
	for _, a := range allowed {
		if v == a {
			return v
		}
	}
	l.fail(key, "%q is not one of %s", v, strings.Join(allowed, ", "))
	return def
}

func (l *loader) duration(key string, def time.Duration) time.Duration {
	v := l.raw(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		l.fail(key, "%q is not a positive duration (examples: 800ms, 15s, 1m)", v)
		return def
	}
	return d
}

func (l *loader) integer(key string, def, minVal, maxVal int) int {
	v := l.raw(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < minVal || n > maxVal {
		l.fail(key, "%q is not an integer between %d and %d", v, minVal, maxVal)
		return def
	}
	return n
}

func (l *loader) location(key, def string) *time.Location {
	v := l.raw(key)
	if v == "" {
		v = def
	}
	loc, err := time.LoadLocation(v)
	if err != nil {
		l.fail(key, "unknown time zone %q", v)
		return time.UTC
	}
	return loc
}

func (l *loader) level(key string, def slog.Level) slog.Level {
	v := l.raw(key)
	if v == "" {
		return def
	}
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(v)); err != nil {
		l.fail(key, "%q is not one of debug, info, warn, error", v)
		return def
	}
	return lvl
}

func (l *loader) addr(key, def string) string {
	v := l.raw(key)
	if v == "" {
		return def
	}
	_, port, err := net.SplitHostPort(v)
	if err != nil {
		l.fail(key, "%q is not a host:port address (example: :8080)", v)
		return def
	}
	if p, err := strconv.Atoi(port); err != nil || p < 1 || p > 65535 {
		l.fail(key, "invalid port %q", port)
		return def
	}
	return v
}

// url valide une URL obligatoire. Le message d'erreur ne reprend jamais la valeur,
// qui peut contenir un mot de passe.
func (l *loader) url(key string, schemes ...string) string {
	v := l.raw(key)
	if v == "" {
		l.fail(key, "is required")
		return ""
	}
	u, err := url.Parse(v)
	if err != nil || u.Host == "" {
		l.fail(key, "is not a valid URL")
		return ""
	}
	for _, s := range schemes {
		if u.Scheme == s {
			return v
		}
	}
	l.fail(key, "scheme %q is not one of %s", u.Scheme, strings.Join(schemes, ", "))
	return ""
}

// optionalURL valide une URL facultative (valeur par défaut sinon).
func (l *loader) optionalURL(key, def string, schemes ...string) string {
	if l.raw(key) == "" {
		return def
	}
	return l.url(key, schemes...)
}

func (l *loader) list(key string) []string {
	var out []string
	for item := range strings.SplitSeq(l.raw(key), ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func (l *loader) prefixes(key string) []netip.Prefix {
	var out []netip.Prefix
	for _, item := range l.list(key) {
		if p, err := netip.ParsePrefix(item); err == nil {
			out = append(out, p.Masked())
			continue
		}
		if a, err := netip.ParseAddr(item); err == nil {
			out = append(out, netip.PrefixFrom(a.Unmap(), a.Unmap().BitLen()))
			continue
		}
		l.fail(key, "%q is neither an IP address nor a CIDR prefix", item)
	}
	return out
}

// origins valide les origines CORS : schéma http(s), hôte, ni chemin ni joker
// (les credentials sont autorisés, « * » est donc interdit).
func (l *loader) origins(key string) []string {
	var out []string
	for _, item := range l.list(key) {
		u, err := url.Parse(item)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
			(u.Path != "" && u.Path != "/") || u.RawQuery != "" {
			l.fail(key, "%q is not an origin such as https://admin.example.com", item)
			continue
		}
		out = append(out, u.Scheme+"://"+u.Host)
	}
	return out
}
