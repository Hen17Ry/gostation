-- Plans réels des requêtes de stats admin (étape 7) sur le jeu seed-dev (make seed-dev : 30 jours de
-- search_stats). Les périodes de 7 et 30 jours se lisent dans les agrégats (search_stats_daily,
-- search_stats_totals) tenus par le vidage du worker ; seule la période de 24 h lit search_stats, par
-- son index primaire (bucket en tête). Lancé par scripts/explain-stats.sh.
\pset pager off
\echo '── Carte des pénuries, 30 jours, tous produits (CellStatsDaily)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT h3_r7, sum(searches)::bigint, sum(empty_within_5km)::bigint FROM search_stats_daily
WHERE day >= (now() AT TIME ZONE 'Africa/Porto-Novo')::date - 29 AND day <= (now() AT TIME ZONE 'Africa/Porto-Novo')::date
GROUP BY h3_r7;
\echo '── Carte des pénuries, 7 jours, un produit (CellStatsDaily)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT h3_r7, sum(searches)::bigint, sum(empty_within_5km)::bigint FROM search_stats_daily
WHERE day >= (now() AT TIME ZONE 'Africa/Porto-Novo')::date - 6 AND day <= (now() AT TIME ZONE 'Africa/Porto-Novo')::date
  AND product_id = (SELECT id FROM products WHERE code = 'petrol')
GROUP BY h3_r7;
\echo '── Carte des pénuries, 24 h (CellStatsHourly : index primaire de search_stats)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT h3_r7, sum(searches)::bigint, sum(empty_within_5km)::bigint FROM search_stats
WHERE bucket >= date_trunc('hour', now()) - interval '23 hours' AND bucket < date_trunc('hour', now()) + interval '1 hour'
GROUP BY h3_r7;
\echo '── Totaux par produit, 30 jours + période précédente (SearchTotalsByProduct)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT product_id, sum(searches)::bigint, sum(empty_within_5km)::bigint FROM search_stats_totals
WHERE bucket >= now() - interval '60 days' AND bucket < now() GROUP BY product_id;
\echo '── Série par jour et par produit, 30 jours (SearchSeries)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT date_trunc('day', bucket, 'Africa/Porto-Novo'), product_id, sum(searches)::bigint, sum(empty_within_5km)::bigint
FROM search_stats_totals WHERE bucket >= now() - interval '30 days' AND bucket < now() GROUP BY 1, 2 ORDER BY 1, 2;
\echo '── Répartition par heure de la journée, 30 jours (SearchesByHourOfDay)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT extract(hour FROM bucket AT TIME ZONE 'Africa/Porto-Novo')::int, sum(searches)::bigint
FROM search_stats_totals WHERE bucket >= now() - interval '30 days' AND bucket < now() GROUP BY 1 ORDER BY 1;
\echo '── Fraîcheur des stocks par jour, 30 jours (FreshnessSeries)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
WITH s AS (SELECT bucket, sum(fresh) AS fresh FROM stock_freshness_stats WHERE bucket >= now() - interval '30 days' GROUP BY bucket)
SELECT date_trunc('day', bucket, 'Africa/Porto-Novo'), round(avg(fresh)) FROM s GROUP BY 1 ORDER BY 1;
\echo '── Fraîcheur actuelle des stocks (StockFreshnessByProduct)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT ss.product_id,
       count(*) FILTER (WHERE GREATEST(ss.updated_at, ss.last_confirmed_at) > now() - interval '8 hours'),
       count(*) FILTER (WHERE GREATEST(ss.updated_at, ss.last_confirmed_at) <= now() - interval '24 hours')
FROM station_stocks ss
JOIN stations s ON s.id = ss.station_id AND s.status = 'approved'
JOIN products p ON p.id = ss.product_id AND p.is_active
GROUP BY ss.product_id;
\echo '── Liste admin : stations approuvées dont le stock date de 8 à 24 h (ListStationsForAdmin)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT s.id FROM stations s LEFT JOIN users u ON u.id = s.manager_id
WHERE s.status = 'approved' AND s.last_stock_update_at <= now() - interval '8 hours' AND s.last_stock_update_at > now() - interval '24 hours'
ORDER BY s.created_at DESC, s.id DESC LIMIT 21;
