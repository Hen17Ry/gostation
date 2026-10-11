-- Tableau de bord et stats admin (étape 7). Les stats de recherche se lisent dans les agrégats
-- tenus par le vidage du worker : search_stats_totals (heure × produit, tous lieux) pour les totaux,
-- évolutions et séries ; search_stats_daily (jour local × cellule × produit) ou search_stats (heure ×
-- cellule × produit, période de 24 h) pour les cellules. Le seuil d'anonymat k ≥ 5 est appliqué par
-- le service sur l'agrégat affiché, jamais en base.

-- name: CountStationsByStatus :many
-- Un dossier pending ne compte qu'une fois l'email du gérant vérifié (comme la liste admin, D5).
SELECT s.status, count(*)::int AS count
FROM stations s
LEFT JOIN users u ON u.id = s.manager_id
WHERE s.status <> 'pending' OR u.email_verified_at IS NOT NULL
GROUP BY s.status;

-- name: OldestPendingApplication :one
SELECT s.status_changed_at
FROM stations s
JOIN users u ON u.id = s.manager_id
WHERE s.status = 'pending' AND u.email_verified_at IS NOT NULL
ORDER BY s.status_changed_at
LIMIT 1;

-- name: StockFreshnessByProduct :many
-- Fraîcheur actuelle des stocks des stations approuvées (produits actifs) : frais (< 8 h), stale
-- (8 à 24 h), exclus (> 24 h). Sert le tableau de bord et le relevé horaire du worker.
SELECT ss.product_id,
       count(*) FILTER (WHERE GREATEST(ss.updated_at, ss.last_confirmed_at) > @stale_since::timestamptz)::int AS fresh,
       count(*) FILTER (WHERE GREATEST(ss.updated_at, ss.last_confirmed_at) <= @stale_since::timestamptz
                          AND GREATEST(ss.updated_at, ss.last_confirmed_at) > @expired_since::timestamptz)::int AS stale,
       count(*) FILTER (WHERE GREATEST(ss.updated_at, ss.last_confirmed_at) <= @expired_since::timestamptz)::int AS expired
FROM station_stocks ss
JOIN stations s ON s.id = ss.station_id AND s.status = 'approved'
JOIN products p ON p.id = ss.product_id AND p.is_active
GROUP BY ss.product_id;

-- name: UpsertFreshnessSnapshot :exec
INSERT INTO stock_freshness_stats (bucket, product_id, fresh, stale, expired)
VALUES (@bucket, @product_id, @fresh, @stale, @expired)
ON CONFLICT (bucket, product_id) DO UPDATE
SET fresh = EXCLUDED.fresh, stale = EXCLUDED.stale, expired = EXCLUDED.expired;

-- name: CountOpenAdminAlerts :many
SELECT kind, count(*)::int AS count FROM admin_alerts WHERE resolved_at IS NULL GROUP BY kind;

-- name: CountOpenReports :one
SELECT count(*)::int FROM reports WHERE status = 'open';

-- name: CountReportsCreated :one
SELECT count(*)::int FROM reports WHERE created_at >= @since::timestamptz AND created_at < @until::timestamptz;

-- name: CountRegistrations :one
SELECT count(*) FILTER (WHERE role = 'user')::int AS users,
       count(*) FILTER (WHERE role = 'manager')::int AS managers
FROM users
WHERE created_at >= @since::timestamptz AND created_at < @until::timestamptz;

-- name: SearchTotalsByProduct :many
SELECT product_id, sum(searches)::bigint AS searches, sum(empty_within_5km)::bigint AS empty
FROM search_stats_totals
WHERE bucket >= @since::timestamptz AND bucket < @until::timestamptz
GROUP BY product_id;

-- name: SearchSeries :many
-- Recherches par tranche (heure ou jour local) et par produit.
SELECT date_trunc(@unit::text, bucket, @tz::text)::timestamptz AS at, product_id,
       sum(searches)::bigint AS searches, sum(empty_within_5km)::bigint AS empty
FROM search_stats_totals
WHERE bucket >= @since::timestamptz AND bucket < @until::timestamptz
  AND (sqlc.narg(product_id)::smallint IS NULL OR product_id = sqlc.narg(product_id)::smallint)
GROUP BY 1, 2
ORDER BY 1, 2;

-- name: SearchesByHourOfDay :many
SELECT extract(hour FROM bucket AT TIME ZONE @tz::text)::int AS hour,
       sum(searches)::bigint AS searches, sum(empty_within_5km)::bigint AS empty
FROM search_stats_totals
WHERE bucket >= @since::timestamptz AND bucket < @until::timestamptz
  AND (sqlc.narg(product_id)::smallint IS NULL OR product_id = sqlc.narg(product_id)::smallint)
GROUP BY 1
ORDER BY 1;

-- name: FreshnessSeries :many
-- Fraîcheur moyenne des relevés horaires par tranche (heure ou jour local).
WITH snapshots AS (
  SELECT bucket, sum(fresh) AS fresh, sum(stale) AS stale, sum(expired) AS expired
  FROM stock_freshness_stats
  WHERE bucket >= @since::timestamptz AND bucket < @until::timestamptz
    AND (sqlc.narg(product_id)::smallint IS NULL OR product_id = sqlc.narg(product_id)::smallint)
  GROUP BY bucket
)
SELECT date_trunc(@unit::text, bucket, @tz::text)::timestamptz AS at,
       round(avg(fresh))::int AS fresh, round(avg(stale))::int AS stale, round(avg(expired))::int AS expired
FROM snapshots
GROUP BY 1
ORDER BY 1;

-- name: CellStatsDaily :many
-- Recherches par cellule sur des jours locaux entiers (to_day inclus).
SELECT h3_r7, sum(searches)::bigint AS searches, sum(empty_within_5km)::bigint AS empty
FROM search_stats_daily
WHERE day >= @from_day::date AND day <= @to_day::date
  AND (sqlc.narg(product_id)::smallint IS NULL OR product_id = sqlc.narg(product_id)::smallint)
GROUP BY h3_r7;

-- name: CellStatsHourly :many
-- Recherches par cellule sur une fenêtre horaire (période de 24 h).
SELECT h3_r7, sum(searches)::bigint AS searches, sum(empty_within_5km)::bigint AS empty
FROM search_stats
WHERE bucket >= @since::timestamptz AND bucket < @until::timestamptz
  AND (sqlc.narg(product_id)::smallint IS NULL OR product_id = sqlc.narg(product_id)::smallint)
GROUP BY h3_r7;

-- name: CellProductStatsDaily :many
-- Export des stats : une ligne par cellule et par produit sur la période (seuil appliqué ensuite).
SELECT d.h3_r7, p.code AS product_code, sum(d.searches)::bigint AS searches, sum(d.empty_within_5km)::bigint AS empty
FROM search_stats_daily d
JOIN products p ON p.id = d.product_id
WHERE d.day >= @from_day::date AND d.day <= @to_day::date
  AND (sqlc.narg(product_id)::smallint IS NULL OR d.product_id = sqlc.narg(product_id)::smallint)
GROUP BY d.h3_r7, p.code
ORDER BY d.h3_r7, p.code;

-- name: UpsertSearchStatsDaily :exec
INSERT INTO search_stats_daily (day, h3_r7, product_id, searches, empty_within_5km)
VALUES (@day, @h3_r7, @product_id, @searches, @empty_within_5km)
ON CONFLICT (day, h3_r7, product_id) DO UPDATE
SET searches = search_stats_daily.searches + EXCLUDED.searches,
    empty_within_5km = search_stats_daily.empty_within_5km + EXCLUDED.empty_within_5km;

-- name: UpsertSearchStatsTotals :exec
INSERT INTO search_stats_totals (bucket, product_id, searches, empty_within_5km)
VALUES (@bucket, @product_id, @searches, @empty_within_5km)
ON CONFLICT (bucket, product_id) DO UPDATE
SET searches = search_stats_totals.searches + EXCLUDED.searches,
    empty_within_5km = search_stats_totals.empty_within_5km + EXCLUDED.empty_within_5km;
