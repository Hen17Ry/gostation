-- Plans réels des requêtes de recherche (make explain-search), sur la base de dev seedée
-- (make seed-dev). Mêmes prédicats que Backend/db/queries/search.sql ; comme dans l'API, les
-- paramètres (jour, heure et dates locales, seuil de fraîcheur) sont des constantes calculées
-- avant la requête. Valeurs : Cotonou, bouteille de gaz de 10 kg, rayon 5 km + marge H3.
\set ON_ERROR_STOP on
\pset pager off
SET search_path TO public;
-- Échauffement : le premier appel PostGIS d'une session charge la bibliothèque (~30 ms), ce que
-- l'API ne paie qu'une fois par connexion du pool.
SELECT ST_DWithin(ST_MakePoint(2.42, 6.37)::geography, ST_MakePoint(2.43, 6.37)::geography, 10) \g /dev/null

SELECT (SELECT id FROM products WHERE code = 'lpg_10kg') AS product_id,
       now() - interval '24 hours' AS fresh_since,
       (now() AT TIME ZONE 'Africa/Porto-Novo')::date AS local_date,
       (now() AT TIME ZONE 'Africa/Porto-Novo')::date - 1 AS prev_date,
       extract(isodow FROM now() AT TIME ZONE 'Africa/Porto-Novo') AS isodow,
       extract(isodow FROM (now() AT TIME ZONE 'Africa/Porto-Novo') - interval '1 day') AS prev_isodow,
       to_char(now() AT TIME ZONE 'Africa/Porto-Novo', 'HH24:MI') AS local_time \gset

\echo '── ListOpenCandidatesWithin (rayon 5 km + 530 m, centre de Cotonou) ──'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT s.id, s.name, s.brand, s.lat, s.lng, ss.quantity,
       GREATEST(ss.updated_at, ss.last_confirmed_at)::timestamptz AS fresh_at
FROM stations s
JOIN station_stocks ss ON ss.station_id = s.id AND ss.product_id = :product_id::smallint
JOIN products p ON p.id = ss.product_id AND p.is_active
WHERE s.status = 'approved'
  AND s.location IS NOT NULL
  AND ss.quantity > 0
  AND GREATEST(ss.updated_at, ss.last_confirmed_at) > :'fresh_since'::timestamptz
  AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint(2.4253, 6.3703), 4326)::geography, 5530::float8)
  AND s.id NOT IN (SELECT c.station_id FROM station_closures c WHERE c.closed_on = :'local_date'::date)
  AND EXISTS (
    SELECT 1 FROM station_opening_hours h
    WHERE h.station_id = s.id AND (
      (h.weekday = :isodow::smallint AND :'local_time'::time >= h.opens_at
        AND (h.closes_at <= h.opens_at OR :'local_time'::time < h.closes_at))
      OR (h.weekday = :prev_isodow::smallint AND h.closes_at <= h.opens_at AND :'local_time'::time < h.closes_at
        AND NOT EXISTS (SELECT 1 FROM station_closures c WHERE c.station_id = s.id AND c.closed_on = :'prev_date'::date))))
ORDER BY s.location <-> ST_SetSRID(ST_MakePoint(2.4253, 6.3703), 4326)::geography
LIMIT 20::int;

\echo '── ListStockedCandidatesKNN (repli, Natitingou) ──'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT s.id, s.name, s.brand, s.lat, s.lng, ss.quantity,
       GREATEST(ss.updated_at, ss.last_confirmed_at)::timestamptz AS fresh_at
FROM stations s
JOIN station_stocks ss ON ss.station_id = s.id AND ss.product_id = :product_id::smallint
JOIN products p ON p.id = ss.product_id AND p.is_active
WHERE s.status = 'approved'
  AND s.location IS NOT NULL
  AND ss.quantity > 0
  AND GREATEST(ss.updated_at, ss.last_confirmed_at) > :'fresh_since'::timestamptz
  AND EXISTS (SELECT 1 FROM station_opening_hours h WHERE h.station_id = s.id)
ORDER BY s.location <-> ST_SetSRID(ST_MakePoint(1.3796, 10.3042), 4326)::geography
LIMIT 20::int;
