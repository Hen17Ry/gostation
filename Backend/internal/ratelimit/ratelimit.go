// Package ratelimit implémente un limiteur à fenêtre glissante dans Redis (sliding window counter).
//
// Pour chaque clé, on garde deux compteurs à fenêtre fixe : la fenêtre courante et la précédente.
// L'estimation vaut précédent × (part de la fenêtre courante restant à courir) + courant. C'est
// précis à quelques pourcents près, en O(1) mémoire par clé, contrairement à un journal ZSET.
// Le script Lua rend lecture et incrément atomiques, même avec plusieurs instances de l'API.
package ratelimit

import (
	"context"
	"errors"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// KEYS[1] = fenêtre courante, KEYS[2] = fenêtre précédente.
// ARGV[1] = limite, ARGV[2] = durée de fenêtre (ms), ARGV[3] = temps écoulé dans la fenêtre courante (ms).
// Retourne {autorisé (0|1), nombre de requêtes estimé après cette requête}.
const slidingWindowScript = `
local limit   = tonumber(ARGV[1])
local window  = tonumber(ARGV[2])
local elapsed = tonumber(ARGV[3])
local current  = tonumber(redis.call('GET', KEYS[1]) or '0')
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
local estimate = math.floor(previous * (window - elapsed) / window) + current
if estimate >= limit then
  return {0, estimate}
end
current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], window * 2)
end
return {1, estimate + 1}
`

// Result décrit la décision du limiteur.
type Result struct {
	Allowed   bool
	Limit     int
	Remaining int
	// Reset : temps restant avant la fin de la fenêtre courante.
	Reset time.Duration
	// RetryAfter : délai conseillé avant de réessayer (si refusé).
	RetryAfter time.Duration
}

// Limiter applique des quotas par clé dans Redis.
type Limiter struct {
	rdb    goredis.Scripter
	script *goredis.Script
	prefix string
	now    func() time.Time
}

// Option configure un Limiter.
type Option func(*Limiter)

// WithClock remplace l'horloge (tests).
func WithClock(now func() time.Time) Option {
	return func(l *Limiter) { l.now = now }
}

// WithPrefix change le préfixe des clés Redis (défaut : « rl »).
func WithPrefix(prefix string) Option {
	return func(l *Limiter) { l.prefix = prefix }
}

// New construit un limiteur.
func New(rdb goredis.Scripter, opts ...Option) *Limiter {
	l := &Limiter{
		rdb:    rdb,
		script: goredis.NewScript(slidingWindowScript),
		prefix: "rl",
		now:    time.Now,
	}
	for _, opt := range opts {
		opt(l)
	}
	return l
}

// Allow compte une requête pour key et indique si elle respecte limit requêtes par window.
func (l *Limiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (Result, error) {
	if limit <= 0 || window < time.Millisecond {
		return Result{}, errors.New("ratelimit: limit must be > 0 and window >= 1ms")
	}
	nowMs := l.now().UnixMilli()
	windowMs := window.Milliseconds()
	idx := nowMs / windowMs
	elapsed := nowMs % windowMs

	// Le hash tag {key} garde les deux compteurs sur le même slot (compatibilité Redis Cluster).
	keys := []string{
		fmt.Sprintf("%s:{%s}:%d", l.prefix, key, idx),
		fmt.Sprintf("%s:{%s}:%d", l.prefix, key, idx-1),
	}
	vals, err := l.script.Run(ctx, l.rdb, keys, limit, windowMs, elapsed).Int64Slice()
	if err != nil {
		return Result{}, fmt.Errorf("ratelimit: run script: %w", err)
	}
	if len(vals) != 2 {
		return Result{}, fmt.Errorf("ratelimit: unexpected script reply %v", vals)
	}

	reset := time.Duration(windowMs-elapsed) * time.Millisecond
	res := Result{
		Allowed:   vals[0] == 1,
		Limit:     limit,
		Remaining: max(0, limit-int(vals[1])),
		Reset:     reset,
	}
	if !res.Allowed {
		// Borne haute : au début de la fenêtre suivante, la fenêtre courante devient « précédente »
		// et ne pèse plus que partiellement.
		res.RetryAfter = reset
	}
	return res, nil
}
