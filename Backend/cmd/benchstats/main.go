// Commande benchstats : mesure la latence des requêtes de stats admin (tableau de bord, stats des
// recherches, carte des pénuries, carte et liste des stations) sur la base de dev, après make
// seed-dev (30 jours de search_stats). Appelle les services exactement comme les handlers, sans
// HTTP ni sérialisation. Échoue si un p95 dépasse la cible (300 ms par défaut).
//
// Usage : benchstats [-n 60] [-target 300ms]   (make bench-stats)
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"slices"
	"time"

	"gostation/backend/internal/analytics"
	"gostation/backend/internal/config"
	"gostation/backend/internal/platform/postgres"
	"gostation/backend/internal/station"
	"gostation/backend/internal/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "benchstats:", err)
		os.Exit(1)
	}
}

type scenario struct {
	name string
	call func(ctx context.Context) error
}

func percentile(sorted []time.Duration, p float64) time.Duration {
	i := int(float64(len(sorted)-1) * p)
	return sorted[i]
}

func run() error {
	n := flag.Int("n", 60, "mesures par scénario (après 3 appels d'échauffement)")
	target := flag.Duration("target", 300*time.Millisecond, "p95 maximal")
	flag.Parse()
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	if cfg.Env != config.EnvDevelopment {
		return fmt.Errorf("refused: APP_ENV=%s (development only)", cfg.Env)
	}
	ctx := context.Background()
	pool, err := postgres.Connect(ctx, postgres.Options{URL: cfg.Postgres.URL, MaxConns: 8, AppName: "gostation-benchstats"})
	if err != nil {
		return err
	}
	defer pool.Close()
	st := store.New(pool)
	an := analytics.New(analytics.Config{Timezone: cfg.Timezone, StaleAfter: cfg.Stock.StaleAfter, ExpiredAfter: cfg.Stock.ExpiredAfter}, st, nil)
	stations := station.NewService(station.Config{Timezone: cfg.Timezone, StaleAfter: cfg.Stock.StaleAfter, ExpiredAfter: cfg.Stock.ExpiredAfter}, station.Deps{Store: st})
	products, err := st.ListActiveProducts(ctx)
	if err != nil {
		return fmt.Errorf("list products: %w", err)
	}
	if len(products) == 0 {
		return fmt.Errorf("no active product (run make seed-dev)")
	}
	petrol := products[0].ID
	for _, p := range products {
		if p.Code == "petrol" {
			petrol = p.ID
		}
	}
	period := func(key string) analytics.Period {
		p, err := an.Period(key, "", "")
		if err != nil {
			panic(err)
		}
		return p
	}
	scenarios := []scenario{
		{"dashboard 24h", func(ctx context.Context) error { _, err := an.Dashboard(ctx, period(analytics.Period24h)); return err }},
		{"dashboard 7d", func(ctx context.Context) error { _, err := an.Dashboard(ctx, period(analytics.Period7d)); return err }},
		{"dashboard 30d", func(ctx context.Context) error { _, err := an.Dashboard(ctx, period(analytics.Period30d)); return err }},
		{"searches 30d", func(ctx context.Context) error {
			_, err := an.SearchStats(ctx, period(analytics.Period30d), nil)
			return err
		}},
		{"searches 30d petrol", func(ctx context.Context) error {
			_, err := an.SearchStats(ctx, period(analytics.Period30d), &petrol)
			return err
		}},
		{"shortages 24h", func(ctx context.Context) error {
			_, err := an.ShortageMap(ctx, period(analytics.Period24h), nil, false)
			return err
		}},
		{"shortages 7d petrol", func(ctx context.Context) error {
			_, err := an.ShortageMap(ctx, period(analytics.Period7d), &petrol, false)
			return err
		}},
		{"shortages 30d", func(ctx context.Context) error {
			_, err := an.ShortageMap(ctx, period(analytics.Period30d), nil, false)
			return err
		}},
		{"stations map", func(ctx context.Context) error { _, err := stations.Map(ctx, "all"); return err }},
		{"stations stale", func(ctx context.Context) error {
			_, err := stations.AdminList(ctx, station.AdminFilter{Status: "approved", Freshness: station.FreshnessStale, Limit: 50})
			return err
		}},
	}
	fmt.Printf("%-22s %8s %8s %8s %8s\n", "scenario", "p50", "p95", "p99", "max")
	failed := false
	for _, sc := range scenarios {
		for range 3 {
			if err := sc.call(ctx); err != nil {
				return fmt.Errorf("%s: %w", sc.name, err)
			}
		}
		durations := make([]time.Duration, 0, *n)
		for range *n {
			start := time.Now()
			if err := sc.call(ctx); err != nil {
				return fmt.Errorf("%s: %w", sc.name, err)
			}
			durations = append(durations, time.Since(start))
		}
		slices.Sort(durations)
		p95 := percentile(durations, 0.95)
		mark := ""
		if p95 > *target {
			mark, failed = "  ✗ > "+target.String(), true
		}
		ms := func(d time.Duration) string { return fmt.Sprintf("%.1fms", float64(d.Microseconds())/1000) }
		fmt.Printf("%-22s %8s %8s %8s %8s%s\n", sc.name, ms(percentile(durations, 0.5)), ms(p95), ms(percentile(durations, 0.99)), ms(durations[len(durations)-1]), mark)
	}
	if failed {
		return fmt.Errorf("p95 above %s", *target)
	}
	fmt.Printf("ok: every p95 under %s\n", *target)
	return nil
}
