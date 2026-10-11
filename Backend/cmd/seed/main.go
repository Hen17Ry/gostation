// Commande seed : génère des stations fictives réparties au Bénin pour le développement et le
// bench de la recherche (make seed-dev). Refuse de tourner hors APP_ENV=development.
//
// Les stations sont marquées is_demo = true et n'ont pas de gérant ; chaque exécution remplace
// les stations fictives précédentes (déterministe pour une graine donnée). Répartition : grappes
// autour des villes (pondérées par leur taille) et un semis uniforme sur le pays ; les points
// hors frontière sont écartés par PostGIS.
//
// Usage : seed [-count 5000] [-seed 42] [-reset]
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"math"
	"math/rand/v2"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"gostation/backend/internal/config"
	"gostation/backend/internal/platform/h3"
	"gostation/backend/internal/platform/postgres"
	"gostation/backend/internal/platform/redis"
	"gostation/backend/internal/searchcache"
)

type city struct {
	name     string
	lat, lng float64
	weight   float64 // part des stations en grappe
	spreadKm float64 // écart-type de la grappe
}

// Villes du Bénin (coordonnées approximatives du centre).
var cities = []city{
	{"Cotonou", 6.3703, 2.3912, 22, 4},
	{"Abomey-Calavi", 6.4485, 2.3557, 9, 4},
	{"Porto-Novo", 6.4969, 2.6036, 8, 3},
	{"Parakou", 9.3370, 2.6303, 7, 4},
	{"Djougou", 9.7085, 1.6660, 4, 3},
	{"Bohicon", 7.1783, 2.0667, 4, 3},
	{"Abomey", 7.1829, 1.9912, 3, 3},
	{"Natitingou", 10.3042, 1.3796, 3, 3},
	{"Kandi", 11.1342, 2.9386, 3, 3},
	{"Lokossa", 6.6387, 1.7167, 3, 3},
	{"Ouidah", 6.3631, 2.0851, 3, 2},
	{"Malanville", 11.8618, 3.3862, 2, 3},
	{"Savè", 8.0342, 2.4866, 2, 3},
	{"Nikki", 9.9401, 3.2108, 2, 3},
	{"Dassa-Zoumè", 7.7500, 2.1833, 2, 3},
	{"Allada", 6.6650, 2.1514, 2, 2},
	{"Sèmè-Podji", 6.3833, 2.6167, 3, 2},
}

// Emprise du Bénin (le filtre exact est fait par PostGIS).
const (
	minLat, maxLat = 6.2, 12.42
	minLng, maxLng = 0.77, 3.86
	uniformShare   = 0.2
)

var brands = []string{"Démo Énergie", "Gaz Démo", "Station Démo", "Carbu Démo"}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		os.Exit(1)
	}
}

func run() error {
	count := flag.Int("count", 5000, "nombre de stations fictives")
	seed := flag.Uint64("seed", 42, "graine du générateur (résultat déterministe)")
	reset := flag.Bool("reset", false, "supprime les stations fictives sans en recréer")
	flag.Parse()

	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	if cfg.Env != config.EnvDevelopment {
		return fmt.Errorf("refused: APP_ENV=%s (development only)", cfg.Env)
	}
	if *count < 1 || *count > 100_000 {
		return errors.New("-count must be between 1 and 100000")
	}
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	pool, err := postgres.Connect(ctx, postgres.Options{URL: cfg.Postgres.URL, MaxConns: 4, AppName: "gostation-seed"})
	if err != nil {
		return err
	}
	defer pool.Close()
	rdb, err := redis.Connect(ctx, cfg.Redis.URL)
	if err != nil {
		return err
	}
	defer func() { _ = rdb.Close() }()

	start := time.Now()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	tag, err := tx.Exec(ctx, `DELETE FROM stations WHERE is_demo`)
	if err != nil {
		return fmt.Errorf("delete demo stations: %w", err)
	}
	log.Info("previous demo stations deleted", slog.Int64("count", tag.RowsAffected()))
	if !*reset {
		if err := generate(ctx, tx, *count, rand.New(rand.NewPCG(*seed, *seed^0x9e3779b97f4a7c15)), cfg.Timezone); err != nil { //nolint:gosec // données fictives
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if err := searchcache.New(rdb).All(ctx); err != nil {
		log.Warn("search cache not invalidated", slog.Any("err", err))
	}
	if _, err := pool.Exec(ctx, `ANALYZE stations; ANALYZE station_stocks; ANALYZE station_opening_hours`); err != nil {
		return err
	}
	log.Info("done", slog.Int("count", map[bool]int{true: 0, false: *count}[*reset]), slog.Duration("took", time.Since(start).Round(time.Millisecond)))
	return nil
}

type point struct {
	lat, lng float64
	city     string
}

func gaussian(r *rand.Rand, c city) point {
	// Coordonnées polaires : distance ~ |N(0, spread)|, cap uniforme.
	d := math.Abs(r.NormFloat64()) * c.spreadKm * 1000
	theta := r.Float64() * 2 * math.Pi
	dLat := d * math.Cos(theta) / 111_320
	dLng := d * math.Sin(theta) / (111_320 * math.Cos(c.lat*math.Pi/180))
	return point{lat: c.lat + dLat, lng: c.lng + dLng, city: c.name}
}

func candidates(r *rand.Rand, n int) []point {
	var total float64
	for _, c := range cities {
		total += c.weight
	}
	out := make([]point, 0, n)
	for range n {
		if r.Float64() < uniformShare {
			out = append(out, point{lat: minLat + r.Float64()*(maxLat-minLat), lng: minLng + r.Float64()*(maxLng-minLng)})
			continue
		}
		x := r.Float64() * total
		for _, c := range cities {
			if x -= c.weight; x <= 0 {
				out = append(out, gaussian(r, c))
				break
			}
		}
	}
	return out
}

// insidePoints ne garde que les points au Bénin (frontière réelle, sans marge).
func insidePoints(ctx context.Context, tx pgx.Tx, pts []point) ([]point, error) {
	lats, lngs := make([]float64, len(pts)), make([]float64, len(pts))
	for i, p := range pts {
		lats[i], lngs[i] = p.lat, p.lng
	}
	rows, err := tx.Query(ctx, `SELECT p.i FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS p(lat, lng, i)
		JOIN country_boundaries b ON b.code = 'BEN'
		WHERE ST_Covers(b.boundary, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography)
		ORDER BY p.i`, lats, lngs)
	if err != nil {
		return nil, fmt.Errorf("filter points: %w", err)
	}
	idx, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return nil, err
	}
	out := make([]point, 0, len(idx))
	for _, i := range idx {
		out = append(out, pts[i-1])
	}
	return out, nil
}

type product struct {
	id      int16
	liters  bool
	sellPct float64
}

func loadProducts(ctx context.Context, tx pgx.Tx) ([]product, error) {
	rows, err := tx.Query(ctx, `SELECT id, unit = 'liter' FROM products WHERE is_active AND code IN ('lpg_5kg', 'lpg_10kg', 'lpg_25kg', 'petrol', 'diesel') ORDER BY sort_order`)
	if err != nil {
		return nil, err
	}
	var out []product
	for rows.Next() {
		var p product
		if err := rows.Scan(&p.id, &p.liters); err != nil {
			return nil, err
		}
		p.sellPct = 0.6
		if p.liters {
			p.sellPct = 0.85
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func clock(h, m int) pgtype.Time {
	return pgtype.Time{Microseconds: int64(h*60+m) * int64(time.Minute/time.Microsecond), Valid: true}
}

func generate(ctx context.Context, tx pgx.Tx, count int, r *rand.Rand, tz *time.Location) error {
	var pts []point
	for len(pts) < count {
		batch, err := insidePoints(ctx, tx, candidates(r, (count-len(pts))*13/10+10))
		if err != nil {
			return err
		}
		pts = append(pts, batch...)
	}
	pts = pts[:count]
	products, err := loadProducts(ctx, tx)
	if err != nil {
		return err
	}
	now := time.Now()
	today := now.In(tz)

	ids := make([]uuid.UUID, count)
	var stations, hours, stocks, closures [][]any
	for i, p := range pts {
		id, err := uuid.NewV7()
		if err != nil {
			return err
		}
		ids[i] = id
		cityName := p.city
		if cityName == "" {
			cityName = "Zone rurale"
		}
		status := "approved"
		switch x := r.Float64(); {
		case x < 0.03:
			status = "pending"
		case x < 0.05:
			status = "suspended"
		}
		var brand *string
		if r.Float64() < 0.7 {
			b := brands[r.IntN(len(brands))]
			brand = &b
		}
		cell, err := h3.CellAt(p.lat, p.lng, h3.ResSearchCache)
		if err != nil {
			return err
		}
		stations = append(stations, []any{
			id, status, fmt.Sprintf("Station démo %04d – %s", i+1, cityName), brand, fmt.Sprintf("9%012d", i+1),
			"RB/DEMO/26 B " + fmt.Sprint(i+1), "Adresse fictive", cityName, "+2290100000000", p.lat, p.lng, h3.ToInt64(cell),
		})

		// Horaires : 40 % 24 h/24, 45 % 6 h–22 h, 10 % coupure le midi et dimanche fermé, 5 % sans horaires.
		switch x := r.Float64(); {
		case x < 0.40:
			for d := int16(1); d <= 7; d++ {
				hours = append(hours, []any{id, d, clock(0, 0), clock(24, 0)})
			}
		case x < 0.85:
			for d := int16(1); d <= 7; d++ {
				hours = append(hours, []any{id, d, clock(6, 0), clock(22, 0)})
			}
		case x < 0.95:
			for d := int16(1); d <= 6; d++ {
				hours = append(hours, []any{id, d, clock(6, 30), clock(12, 30)}, []any{id, d, clock(14, 0), clock(21, 0)})
			}
		}
		if r.Float64() < 0.02 {
			closures = append(closures, []any{id, pgtype.Date{Time: time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC), Valid: true}})
		}

		// Stocks : 15 % à 0 ; fraîcheur 70 % < 8 h, 20 % 8–24 h, 10 % expirée.
		for _, pr := range products {
			if r.Float64() >= pr.sellPct {
				continue
			}
			qty := int32(0)
			if r.Float64() >= 0.15 {
				if pr.liters {
					qty = int32(500 + r.IntN(20_000)) //nolint:gosec // borné
				} else {
					qty = int32(1 + r.IntN(120)) //nolint:gosec // borné
				}
			}
			var age time.Duration
			switch x := r.Float64(); {
			case x < 0.70:
				age = time.Duration(r.Int64N(int64(8 * time.Hour)))
			case x < 0.90:
				age = 8*time.Hour + time.Duration(r.Int64N(int64(16*time.Hour)))
			default:
				age = 24*time.Hour + time.Duration(r.Int64N(int64(72*time.Hour)))
			}
			at := now.Add(-age)
			stocks = append(stocks, []any{id, pr.id, qty, at, at})
		}
	}

	if _, err := tx.Exec(ctx, `CREATE TEMP TABLE seed_stations (
		id uuid, status text, name text, brand text, ifu text, rccm text, address text, city text, phone text,
		lat float8, lng float8, h3_r8 bigint) ON COMMIT DROP`); err != nil {
		return err
	}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"seed_stations"},
		[]string{"id", "status", "name", "brand", "ifu", "rccm", "address", "city", "phone", "lat", "lng", "h3_r8"},
		pgx.CopyFromRows(stations)); err != nil {
		return fmt.Errorf("copy stations: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO stations (id, status, name, brand, ifu, rccm, address, city, phone,
		location, location_set_at, h3_r8, is_demo, reviewed_at, last_stock_update_at)
		SELECT id, status::station_status, name, brand, ifu, rccm, address, city, phone,
		       ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, now(), h3_r8, true, now(), now()
		FROM seed_stations`); err != nil {
		return fmt.Errorf("insert stations: %w", err)
	}
	for _, c := range []struct {
		table string
		cols  []string
		rows  [][]any
	}{
		{"station_opening_hours", []string{"station_id", "weekday", "opens_at", "closes_at"}, hours},
		{"station_stocks", []string{"station_id", "product_id", "quantity", "updated_at", "last_confirmed_at"}, stocks},
		{"station_closures", []string{"station_id", "closed_on"}, closures},
	} {
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{c.table}, c.cols, pgx.CopyFromRows(c.rows)); err != nil {
			return fmt.Errorf("copy %s: %w", c.table, err)
		}
	}
	return nil
}
