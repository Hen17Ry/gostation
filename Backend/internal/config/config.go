// Package config charge la configuration depuis l'environnement, une seule fois au démarrage.
// Toutes les valeurs invalides sont signalées ensemble, avec le nom de la variable en cause.
// La source de vérité des variables est .env.example à la racine du dépôt.
package config

import (
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
		IPRequests: l.integer("RATE_LIMIT_IP_REQUESTS", 300, 1, 1_000_000),
		IPWindow:   l.duration("RATE_LIMIT_IP_WINDOW", time.Minute),
	}
	if c.RateLimit.IPWindow < time.Second {
		l.fail("RATE_LIMIT_IP_WINDOW", "must be at least 1s")
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
