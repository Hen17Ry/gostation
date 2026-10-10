package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"time"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/ratelimit"
)

// Limiter est implémenté par *ratelimit.Limiter (Redis).
type Limiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (ratelimit.Result, error)
}

// RateLimitPolicy décrit un quota : Limit requêtes par Window, par valeur de Key.
type RateLimitPolicy struct {
	Name   string
	Limit  int
	Window time.Duration
	// Key renvoie l'identifiant à limiter ; "" exempte la requête.
	Key func(*http.Request) string
}

// RateLimit applique la politique et pose les en-têtes RateLimit-Limit/Remaining/Reset
// (et Retry-After sur 429). Si Redis est indisponible, la requête passe (fail open) avec un
// avertissement : la disponibilité du service prime sur le quota.
func RateLimit(l Limiter, p RateLimitPolicy, log *slog.Logger, rs *respond.Responder) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := p.Key(r)
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}
			res, err := l.Allow(r.Context(), p.Name+":"+key, p.Limit, p.Window)
			if err != nil {
				log.WarnContext(r.Context(), "rate limiter unavailable, request allowed",
					slog.String("policy", p.Name), slog.Any("err", err))
				next.ServeHTTP(w, r)
				return
			}
			h := w.Header()
			h.Set("RateLimit-Limit", strconv.Itoa(res.Limit))
			h.Set("RateLimit-Remaining", strconv.Itoa(res.Remaining))
			h.Set("RateLimit-Reset", ceilSeconds(res.Reset))
			if !res.Allowed {
				h.Set("Retry-After", ceilSeconds(res.RetryAfter))
				rs.Error(w, r, apperr.TooManyRequests("Too many requests, retry later."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ByClientIP identifie le client par une empreinte de son IP : l'adresse en clair n'est
// jamais écrite dans Redis.
func ByClientIP(r *http.Request) string {
	ip, ok := httpctx.ClientIP(r.Context())
	if !ok {
		return ""
	}
	sum := sha256.Sum256(ip.AsSlice())
	return hex.EncodeToString(sum[:12])
}

func ceilSeconds(d time.Duration) string {
	return strconv.Itoa(int(math.Ceil(d.Seconds())))
}
