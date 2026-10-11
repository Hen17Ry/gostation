package main

import (
	"context"
	"fmt"
	"math"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gostation/backend/internal/platform/h3"
)

// Historique fictif des stats de recherche (search_stats) et des relevés de fraîcheur
// (stock_freshness_stats), pour le tableau de bord admin et la mesure des requêtes de stats.
//
// Volume : environ 40 000 recherches par jour, réparties sur les cellules H3 res 7 au prorata
// d'un semis de points (grappes autour des villes et semis uniforme), selon un profil horaire
// (pointes du matin et du soir). Le taux de recherches « sans station ouverte à 5 km » d'une
// cellule dépend du nombre de stations fictives approuvées à 5 km de son centre : les zones
// rurales sans station ressortent en pénurie.

const (
	dailySearches = 40_000
	cellSamples   = 30_000
)

// hourProfile est la part des recherches d'une journée par heure locale (somme = 1).
var hourProfile = func() [24]float64 {
	raw := [24]float64{0.3, 0.2, 0.15, 0.15, 0.3, 1.2, 3.5, 6, 7, 6, 5.5, 5.5, 6, 5.5, 5, 5, 5.5, 6.5, 7, 6, 4.5, 3, 1.8, 0.8}
	var sum float64
	for _, v := range raw {
		sum += v
	}
	for i := range raw {
		raw[i] /= sum
	}
	return raw
}()

type statsCell struct {
	cell   int64
	lat    float64
	lng    float64
	weight float64
	empty  float64 // probabilité qu'une recherche n'ait aucune station ouverte à 5 km
}

type statsProduct struct {
	id    int16
	share float64 // part des recherches
	scale float64 // multiplicateur du taux de pénurie
}

// poisson tire une loi de Poisson (Knuth pour les petites moyennes, approximation normale sinon).
func poisson(r *rand.Rand, lambda float64) int {
	if lambda <= 0 {
		return 0
	}
	if lambda > 30 {
		return max(0, int(math.Round(lambda+math.Sqrt(lambda)*r.NormFloat64())))
	}
	l, k, p := math.Exp(-lambda), 0, 1.0
	for {
		p *= r.Float64()
		if p <= l {
			return k
		}
		k++
	}
}

// binomial tire le nombre de succès parmi n essais de probabilité p.
func binomial(r *rand.Rand, n int, p float64) int {
	if n > 50 {
		mean, sd := float64(n)*p, math.Sqrt(float64(n)*p*(1-p))
		return min(n, max(0, int(math.Round(mean+sd*r.NormFloat64()))))
	}
	k := 0
	for range n {
		if r.Float64() < p {
			k++
		}
	}
	return k
}

func statsCells(ctx context.Context, pool *pgxpool.Pool, r *rand.Rand) ([]statsCell, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	pts, err := insidePoints(ctx, tx, candidates(r, cellSamples))
	if err != nil {
		return nil, err
	}
	weights := map[int64]float64{}
	for _, p := range pts {
		c, err := h3.CellAt(p.lat, p.lng, h3.ResStats)
		if err != nil {
			return nil, err
		}
		weights[h3.ToInt64(c)]++
	}
	cells := make([]statsCell, 0, len(weights))
	ids, lats, lngs := make([]int64, 0, len(weights)), make([]float64, 0, len(weights)), make([]float64, 0, len(weights))
	for id, w := range weights {
		lat, lng, err := h3.Center(h3.FromInt64(id))
		if err != nil {
			return nil, err
		}
		cells = append(cells, statsCell{cell: id, lat: lat, lng: lng, weight: w})
		ids, lats, lngs = append(ids, id), append(lats, lat), append(lngs, lng)
	}
	// Stations fictives approuvées à 5 km du centre de chaque cellule.
	rows, err := tx.Query(ctx, `SELECT c.id, (SELECT count(*) FROM stations s WHERE s.status = 'approved'
		  AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)::geography, 5000))::int
		FROM unnest($1::bigint[], $2::float8[], $3::float8[]) AS c(id, lat, lng)`, ids, lats, lngs)
	if err != nil {
		return nil, fmt.Errorf("stations near cells: %w", err)
	}
	near := map[int64]int{}
	for rows.Next() {
		var id int64
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		near[id] = n
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range cells {
		switch n := near[cells[i].cell]; {
		case n == 0:
			cells[i].empty = 0.75 + r.Float64()*0.2
		case n <= 2:
			cells[i].empty = 0.35 + r.Float64()*0.3
		case n <= 9:
			cells[i].empty = 0.08 + r.Float64()*0.15
		default:
			cells[i].empty = 0.02 + r.Float64()*0.06
		}
	}
	return cells, nil
}

func statsProducts(ctx context.Context, pool *pgxpool.Pool) ([]statsProduct, error) {
	rows, err := pool.Query(ctx, `SELECT id, code FROM products WHERE is_active AND code IN ('lpg_5kg', 'lpg_10kg', 'lpg_25kg', 'petrol', 'diesel')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	shares := map[string][2]float64{
		"petrol": {0.38, 1}, "diesel": {0.17, 1.2}, "lpg_10kg": {0.2, 1.3}, "lpg_5kg": {0.17, 1.1}, "lpg_25kg": {0.08, 1.6},
	}
	var out []statsProduct
	for rows.Next() {
		var id int16
		var code string
		if err := rows.Scan(&id, &code); err != nil {
			return nil, err
		}
		out = append(out, statsProduct{id: id, share: shares[code][0], scale: shares[code][1]})
	}
	return out, rows.Err()
}

// generateStats remplace l'historique des days derniers jours (heure en cours comprise).
func generateStats(ctx context.Context, pool *pgxpool.Pool, days int, r *rand.Rand, tz *time.Location) (int, error) {
	cells, err := statsCells(ctx, pool, r)
	if err != nil {
		return 0, err
	}
	products, err := statsProducts(ctx, pool)
	if err != nil {
		return 0, err
	}
	var totalWeight float64
	for _, c := range cells {
		totalWeight += c.weight
	}
	end := time.Now().UTC().Truncate(time.Hour)
	start := end.Add(-time.Duration(days) * 24 * time.Hour)

	var rows [][]any
	for bucket := start; !bucket.After(end); bucket = bucket.Add(time.Hour) {
		local := bucket.In(tz)
		dayFactor := 1.0
		if local.Weekday() == time.Sunday {
			dayFactor = 0.7
		}
		// Légère croissance sur la période et aléa journalier.
		growth := 0.85 + 0.3*float64(bucket.Sub(start))/float64(end.Sub(start)+time.Hour)
		total := dailySearches * hourProfile[local.Hour()] * dayFactor * growth * (0.9 + r.Float64()*0.2)
		for _, c := range cells {
			cellTotal := total * c.weight / totalWeight
			for _, p := range products {
				n := poisson(r, cellTotal*p.share)
				if n == 0 {
					continue
				}
				e := binomial(r, n, math.Min(0.98, c.empty*p.scale))
				rows = append(rows, []any{bucket, c.cell, p.id, int32(n), int32(e)}) //nolint:gosec // bornés
			}
		}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if _, err := tx.Exec(ctx, `DELETE FROM search_stats WHERE bucket >= $1`, start); err != nil {
		return 0, fmt.Errorf("delete search stats: %w", err)
	}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"search_stats"},
		[]string{"bucket", "h3_r7", "product_id", "searches", "empty_within_5km"}, pgx.CopyFromRows(rows)); err != nil {
		return 0, fmt.Errorf("copy search stats: %w", err)
	}
	// Agrégats (jour local et tous lieux), recalculés depuis search_stats sur la période.
	firstDay := start.In(tz).Format(time.DateOnly)
	for _, q := range []string{
		`DELETE FROM search_stats_daily WHERE day >= $1::date`,
		`INSERT INTO search_stats_daily (day, h3_r7, product_id, searches, empty_within_5km)
		 SELECT (bucket AT TIME ZONE $2)::date, h3_r7, product_id, sum(searches), sum(empty_within_5km)
		 FROM search_stats WHERE bucket >= ($1::date::timestamp AT TIME ZONE $2) GROUP BY 1, 2, 3`,
	} {
		args := []any{firstDay}
		if strings.Contains(q, "$2") {
			args = append(args, tz.String())
		}
		if _, err := tx.Exec(ctx, q, args...); err != nil {
			return 0, fmt.Errorf("search stats daily: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM search_stats_totals WHERE bucket >= $1`, start); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO search_stats_totals (bucket, product_id, searches, empty_within_5km)
		SELECT bucket, product_id, sum(searches), sum(empty_within_5km) FROM search_stats WHERE bucket >= $1 GROUP BY 1, 2`, start); err != nil {
		return 0, fmt.Errorf("search stats totals: %w", err)
	}
	if err := generateFreshness(ctx, tx, start, end, r, tz); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	_, err = pool.Exec(ctx, `ANALYZE search_stats; ANALYZE search_stats_daily; ANALYZE search_stats_totals; ANALYZE stock_freshness_stats`)
	return len(rows), err
}

// generateFreshness écrit des relevés horaires plausibles : la part des stocks frais baisse la nuit
// (aucune saisie) et remonte avec les mises à jour du matin.
func generateFreshness(ctx context.Context, tx pgx.Tx, start, end time.Time, r *rand.Rand, tz *time.Location) error {
	type total struct {
		id    int16
		count int
	}
	rows, err := tx.Query(ctx, `SELECT ss.product_id, count(*)::int FROM station_stocks ss
		JOIN stations s ON s.id = ss.station_id AND s.status = 'approved'
		JOIN products p ON p.id = ss.product_id AND p.is_active
		GROUP BY ss.product_id`)
	if err != nil {
		return err
	}
	totals, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (total, error) {
		var t total
		err := row.Scan(&t.id, &t.count)
		return t, err
	})
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM stock_freshness_stats WHERE bucket >= $1`, start); err != nil {
		return err
	}
	var out [][]any
	for bucket := start; !bucket.After(end); bucket = bucket.Add(time.Hour) {
		h := bucket.In(tz).Hour()
		fresh := 0.72
		switch {
		case h < 7:
			fresh = 0.72 - 0.04*float64(h+3) // la nuit, les stocks vieillissent
		case h < 10:
			fresh = 0.55 + 0.06*float64(h-6)
		}
		expired := 0.08 + r.Float64()*0.03
		for _, t := range totals {
			f := int(float64(t.count) * math.Max(0.3, fresh+(r.Float64()-0.5)*0.04))
			e := min(t.count-f, int(float64(t.count)*expired))
			out = append(out, []any{bucket, t.id, int32(f), int32(t.count - f - e), int32(e)}) //nolint:gosec // bornés
		}
	}
	_, err = tx.CopyFrom(ctx, pgx.Identifier{"stock_freshness_stats"},
		[]string{"bucket", "product_id", "fresh", "stale", "expired"}, pgx.CopyFromRows(out))
	return err
}
