-- Migration de données : agrégats des stats déjà vidées. Le jour local suit APP_TIMEZONE, dont la
-- valeur par défaut (Africa/Porto-Novo, UTC+1 sans heure d'été) est reprise ici.

-- +goose Up
INSERT INTO search_stats_daily (day, h3_r7, product_id, searches, empty_within_5km)
SELECT (bucket AT TIME ZONE 'Africa/Porto-Novo')::date, h3_r7, product_id, sum(searches), sum(empty_within_5km)
FROM search_stats
GROUP BY 1, 2, 3
ON CONFLICT DO NOTHING;

INSERT INTO search_stats_totals (bucket, product_id, searches, empty_within_5km)
SELECT bucket, product_id, sum(searches), sum(empty_within_5km)
FROM search_stats
GROUP BY 1, 2
ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM search_stats_totals;
DELETE FROM search_stats_daily;
