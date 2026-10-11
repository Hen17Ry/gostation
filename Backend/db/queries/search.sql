-- Recherche (ARCHITECTURE §4). Filtres communs : station approuvée et épinglée, horaires
-- renseignés, produit actif vendu en quantité > 0, stock frais (GREATEST(updated_at,
-- last_confirmed_at) > fresh_since). « Ouverte maintenant » suit station.Schedule.IsOpen :
-- jour ISO, heure et dates locales (prev_date = veille) calculés en Go, fuseau Africa/Porto-Novo.
-- Pas d'arithmétique sur un paramètre nommé (« @d::date - 1 ») : sqlc la réécrit mal.
-- Fermetures du jour : « NOT IN (sous-requête) » est évalué une seule fois (hashed SubPlan, index
-- idx_station_closures_day), là où NOT EXISTS corrélé re-parcourait la table à chaque station.
-- Signalements (étape 6) : une cause à 5 auteurs ou plus exclut la station (pour le produit, ou
-- entièrement si product_id est NULL) ; à 3, la colonne reported porte le badge « signalé ».

-- name: CheckCoverage :one
-- Couverture d'une position : au Bénin (frontière élargie de 2 km) ? À 30 km ou moins ?
SELECT
  ST_Covers(boundary_buffered, ST_SetSRID(ST_MakePoint(@lng::float8, @lat::float8), 4326)::geography)::boolean AS inside,
  ST_DWithin(boundary, ST_SetSRID(ST_MakePoint(@lng::float8, @lat::float8), 4326)::geography, 30000)::boolean AS near
FROM country_boundaries
WHERE code = 'BEN';

-- name: ListOpenCandidatesWithin :many
SELECT s.id, s.name, s.brand, s.lat, s.lng, ss.quantity,
       GREATEST(ss.updated_at, ss.last_confirmed_at)::timestamptz AS fresh_at,
       EXISTS (SELECT 1 FROM station_report_flags f WHERE f.station_id = s.id
               AND (f.product_id IS NULL OR f.product_id = @product_id::smallint))::boolean AS reported
FROM stations s
JOIN station_stocks ss ON ss.station_id = s.id AND ss.product_id = @product_id::smallint
JOIN products p ON p.id = ss.product_id AND p.is_active
WHERE s.status = 'approved'
  AND s.location IS NOT NULL
  AND ss.quantity > 0
  AND GREATEST(ss.updated_at, ss.last_confirmed_at) > @fresh_since::timestamptz
  AND s.id NOT IN (SELECT f.station_id FROM station_report_flags f WHERE f.excluded_at IS NOT NULL
                   AND (f.product_id IS NULL OR f.product_id = @product_id::smallint))
  AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint(@lng::float8, @lat::float8), 4326)::geography, @radius_m::float8)
  AND s.id NOT IN (SELECT c.station_id FROM station_closures c WHERE c.closed_on = @local_date::date)
  AND EXISTS (
    SELECT 1 FROM station_opening_hours h
    WHERE h.station_id = s.id AND (
      (h.weekday = @isodow::smallint AND @local_time::time >= h.opens_at
        AND (h.closes_at <= h.opens_at OR @local_time::time < h.closes_at))
      OR (h.weekday = @prev_isodow::smallint AND h.closes_at <= h.opens_at AND @local_time::time < h.closes_at
        AND NOT EXISTS (SELECT 1 FROM station_closures c WHERE c.station_id = s.id AND c.closed_on = @prev_date::date))))
ORDER BY s.location <-> ST_SetSRID(ST_MakePoint(@lng::float8, @lat::float8), 4326)::geography
LIMIT @max_candidates::int;

-- name: ListOpenCandidatesKNN :many
-- Repli KNN illimité (aucune station ouverte à 50 km).
SELECT s.id, s.name, s.brand, s.lat, s.lng, ss.quantity,
       GREATEST(ss.updated_at, ss.last_confirmed_at)::timestamptz AS fresh_at,
       EXISTS (SELECT 1 FROM station_report_flags f WHERE f.station_id = s.id
               AND (f.product_id IS NULL OR f.product_id = @product_id::smallint))::boolean AS reported
FROM stations s
JOIN station_stocks ss ON ss.station_id = s.id AND ss.product_id = @product_id::smallint
JOIN products p ON p.id = ss.product_id AND p.is_active
WHERE s.status = 'approved'
  AND s.location IS NOT NULL
  AND ss.quantity > 0
  AND GREATEST(ss.updated_at, ss.last_confirmed_at) > @fresh_since::timestamptz
  AND s.id NOT IN (SELECT f.station_id FROM station_report_flags f WHERE f.excluded_at IS NOT NULL
                   AND (f.product_id IS NULL OR f.product_id = @product_id::smallint))
  AND s.id NOT IN (SELECT c.station_id FROM station_closures c WHERE c.closed_on = @local_date::date)
  AND EXISTS (
    SELECT 1 FROM station_opening_hours h
    WHERE h.station_id = s.id AND (
      (h.weekday = @isodow::smallint AND @local_time::time >= h.opens_at
        AND (h.closes_at <= h.opens_at OR @local_time::time < h.closes_at))
      OR (h.weekday = @prev_isodow::smallint AND h.closes_at <= h.opens_at AND @local_time::time < h.closes_at
        AND NOT EXISTS (SELECT 1 FROM station_closures c WHERE c.station_id = s.id AND c.closed_on = @prev_date::date))))
ORDER BY s.location <-> ST_SetSRID(ST_MakePoint(@lng::float8, @lat::float8), 4326)::geography
LIMIT @max_candidates::int;

-- name: ListStockedCandidatesKNN :many
-- Stations les plus proches en stock frais, avec horaires, ouvertes ou non : le service garde
-- les fermées (repli D19, triées par heure à laquelle on peut être servi).
SELECT s.id, s.name, s.brand, s.lat, s.lng, ss.quantity,
       GREATEST(ss.updated_at, ss.last_confirmed_at)::timestamptz AS fresh_at,
       EXISTS (SELECT 1 FROM station_report_flags f WHERE f.station_id = s.id
               AND (f.product_id IS NULL OR f.product_id = @product_id::smallint))::boolean AS reported
FROM stations s
JOIN station_stocks ss ON ss.station_id = s.id AND ss.product_id = @product_id::smallint
JOIN products p ON p.id = ss.product_id AND p.is_active
WHERE s.status = 'approved'
  AND s.location IS NOT NULL
  AND ss.quantity > 0
  AND GREATEST(ss.updated_at, ss.last_confirmed_at) > @fresh_since::timestamptz
  AND s.id NOT IN (SELECT f.station_id FROM station_report_flags f WHERE f.excluded_at IS NOT NULL
                   AND (f.product_id IS NULL OR f.product_id = @product_id::smallint))
  AND EXISTS (SELECT 1 FROM station_opening_hours h WHERE h.station_id = s.id)
ORDER BY s.location <-> ST_SetSRID(ST_MakePoint(@lng::float8, @lat::float8), 4326)::geography
LIMIT @max_candidates::int;

-- name: ListHoursForStations :many
SELECT station_id, weekday, opens_at, closes_at
FROM station_opening_hours
WHERE station_id = ANY(@station_ids::uuid[]);

-- name: ListClosuresForStations :many
SELECT station_id, closed_on
FROM station_closures
WHERE station_id = ANY(@station_ids::uuid[]) AND closed_on >= @from_date;

-- name: GetPublicStation :one
-- Fiche publique : stations approuvées uniquement (404 sinon).
SELECT id, name, brand, address, city, lat, lng
FROM stations
WHERE id = @id AND status = 'approved';

-- name: ListPublicStocks :many
SELECT p.id, p.code, p.kind, p.unit, p.size_kg, p.label_fr, ss.quantity,
       GREATEST(ss.updated_at, ss.last_confirmed_at)::timestamptz AS fresh_at
FROM station_stocks ss
JOIN products p ON p.id = ss.product_id AND p.is_active
WHERE ss.station_id = @station_id
ORDER BY p.sort_order, p.id;

-- name: UpsertSearchStats :exec
-- Agrégation des compteurs anonymes (cellule H3 res 7, produit, heure) vidés depuis Redis.
INSERT INTO search_stats (bucket, h3_r7, product_id, searches, empty_within_5km)
VALUES (@bucket, @h3_r7, @product_id, @searches, @empty_within_5km)
ON CONFLICT (bucket, h3_r7, product_id) DO UPDATE
SET searches = search_stats.searches + EXCLUDED.searches,
    empty_within_5km = search_stats.empty_within_5km + EXCLUDED.empty_within_5km;
