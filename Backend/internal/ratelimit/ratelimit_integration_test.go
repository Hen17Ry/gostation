//go:build integration

package ratelimit_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"gostation/backend/internal/ratelimit"
	"gostation/backend/internal/testutil"
)

// testRedis est le Redis du paquet, démarré une fois dans TestMain.
var testRedis *goredis.Client

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	url, stop, err := testutil.StartRedis(context.Background())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	opts, err := goredis.ParseURL(url)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	testRedis = goredis.NewClient(opts)
	defer func() { _ = testRedis.Close() }()
	return m.Run()
}

// clock est une horloge manuelle, alignée sur le début d'une minute.
type clock struct{ now time.Time }

func (c *clock) Now() time.Time          { return c.now }
func (c *clock) Advance(d time.Duration) { c.now = c.now.Add(d) }

func newLimiter(t *testing.T) (*ratelimit.Limiter, *clock) {
	c := &clock{now: time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)}
	return ratelimit.New(testRedis, ratelimit.WithClock(c.Now), ratelimit.WithPrefix("test:"+t.Name())), c
}

func allow(t *testing.T, l *ratelimit.Limiter, key string) ratelimit.Result {
	t.Helper()
	res, err := l.Allow(t.Context(), key, 3, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestSlidingWindow(t *testing.T) {
	l, c := newLimiter(t)

	for i, wantRemaining := range []int{2, 1, 0} {
		res := allow(t, l, "ip:a")
		if !res.Allowed || res.Remaining != wantRemaining || res.Limit != 3 {
			t.Fatalf("request %d: %+v, want allowed with %d remaining", i+1, res, wantRemaining)
		}
	}
	res := allow(t, l, "ip:a")
	if res.Allowed || res.RetryAfter != time.Minute {
		t.Fatalf("4th request: %+v, want denied with RetryAfter 1m", res)
	}

	// 30 s dans la fenêtre suivante : la précédente (3) pèse 50 % → estimation 1,5.
	// 1,5 + 1 ≤ 3 : une requête passe ; 2,5 + 1 > 3 : la suivante est refusée.
	c.Advance(90 * time.Second)
	if res := allow(t, l, "ip:a"); !res.Allowed {
		t.Fatalf("after 90s, 1st request denied: %+v", res)
	}
	if res := allow(t, l, "ip:a"); res.Allowed || res.RetryAfter != 30*time.Second {
		t.Fatalf("after 90s, 2nd request: %+v, want denied with RetryAfter 30s", res)
	}

	// Deux fenêtres plus tard, l'historique ne compte plus.
	c.Advance(2 * time.Minute)
	if res := allow(t, l, "ip:a"); !res.Allowed || res.Remaining != 2 {
		t.Fatalf("after 2 windows: %+v, want fresh quota", res)
	}
}

// Limite de 1 : pas de requête de trop juste après un changement de fenêtre (l'estimation
// n'est pas arrondie à l'inférieur).
func TestLimitOfOneIsStrict(t *testing.T) {
	l, c := newLimiter(t)
	c.Advance(59 * time.Second)
	if res, _ := l.Allow(t.Context(), "k", 1, time.Minute); !res.Allowed {
		t.Fatal("first request denied")
	}
	c.Advance(2 * time.Second) // nouvelle fenêtre, la précédente pèse encore ~98 %
	if res, _ := l.Allow(t.Context(), "k", 1, time.Minute); res.Allowed {
		t.Fatal("second request allowed 2 s after the first with a limit of 1 per minute")
	}
}

func TestKeysAreIndependent(t *testing.T) {
	l, _ := newLimiter(t)
	for range 3 {
		allow(t, l, "ip:a")
	}
	if res := allow(t, l, "ip:a"); res.Allowed {
		t.Fatal("ip:a should be limited")
	}
	if res := allow(t, l, "ip:b"); !res.Allowed {
		t.Fatal("ip:b must not be affected by ip:a")
	}
}

func TestCountersExpire(t *testing.T) {
	l, _ := newLimiter(t)
	allow(t, l, "ip:ttl")
	keys, err := testRedis.Keys(t.Context(), "test:"+t.Name()+":*").Result()
	if err != nil || len(keys) != 1 {
		t.Fatalf("keys = %v, %v", keys, err)
	}
	ttl, err := testRedis.PTTL(t.Context(), keys[0]).Result()
	if err != nil || ttl <= time.Minute || ttl > 2*time.Minute {
		t.Errorf("TTL = %s, want ~2 windows (no key may live forever)", ttl)
	}
}

func TestInvalidArguments(t *testing.T) {
	l, _ := newLimiter(t)
	if _, err := l.Allow(t.Context(), "k", 0, time.Minute); err == nil {
		t.Error("limit 0 accepted")
	}
	if _, err := l.Allow(t.Context(), "k", 1, 0); err == nil {
		t.Error("window 0 accepted")
	}
}
