-- name: GetStationByID :one
-- lat/lng sont les colonnes générées depuis location (NULL tant que la station n'est pas
-- épinglée) : le type geography et les champs du justificatif ne sortent jamais de la base.
SELECT id, manager_id, status, name, brand, ifu, rccm, address, city, phone,
       lat, lng, location_set_at, h3_r8, status_reason, reviewed_by, reviewed_at,
       last_stock_update_at, created_at, updated_at
FROM stations
WHERE id = @id;

-- name: CreateStation :one
INSERT INTO stations (manager_id, name, brand, ifu, rccm, address, city, phone,
                      document_object_key, document_wrapped_key, document_sha256, document_mime)
VALUES (@manager_id, @name, sqlc.narg(brand), @ifu, @rccm, @address, sqlc.narg(city), @phone,
        @document_object_key, @document_wrapped_key, @document_sha256, @document_mime)
RETURNING id, status, created_at;

-- name: GetStationByManager :one
SELECT id, manager_id, status, version, name, brand, ifu, rccm, address, city, phone,
       lat, lng, h3_r8, location_set_at, location_flagged_at, location_flag_distance_m, location_flag_accuracy_m,
       status_reason, reviewed_at, last_stock_update_at, created_at, updated_at
FROM stations
WHERE manager_id = @manager_id;

-- name: GetStationDocument :one
-- Métadonnées du justificatif chiffré : lecture réservée aux admins.
SELECT id, document_object_key, document_wrapped_key, document_sha256, document_mime
FROM stations
WHERE id = @id;

-- name: SuspendManagerStation :exec
UPDATE stations SET status = 'suspended', status_reason = @reason, version = version + 1
WHERE manager_id = @manager_id AND status <> 'rejected';

-- name: BumpStationVersion :one
-- Verrouillage optimiste : réussit seulement si la version attendue est la version courante.
-- Pose aussi le verrou de ligne pour le reste de la transaction.
UPDATE stations SET version = version + 1
WHERE id = @id AND version = @expected_version
RETURNING version;

-- name: UpdateStationProfile :exec
UPDATE stations
SET name    = COALESCE(sqlc.narg(name), name),
    brand   = CASE WHEN @set_brand::boolean THEN sqlc.narg(brand) ELSE brand END,
    address = COALESCE(sqlc.narg(address), address),
    city    = CASE WHEN @set_city::boolean THEN sqlc.narg(city) ELSE city END,
    phone   = COALESCE(sqlc.narg(phone), phone),
    ifu     = COALESCE(sqlc.narg(ifu), ifu),
    rccm    = COALESCE(sqlc.narg(rccm), rccm)
WHERE id = @id;

-- name: SetStationStatus :exec
-- Changement de statut. reviewed_by/at ne sont renseignés que pour une décision admin.
UPDATE stations
SET status        = @status,
    status_reason = sqlc.narg(reason),
    reviewed_by   = sqlc.narg(reviewed_by),
    reviewed_at   = CASE WHEN sqlc.narg(reviewed_by)::uuid IS NULL THEN reviewed_at ELSE now() END
WHERE id = @id;

-- name: ReplaceStationDocument :exec
UPDATE stations
SET document_object_key = @document_object_key, document_wrapped_key = @document_wrapped_key,
    document_sha256 = @document_sha256, document_mime = @document_mime
WHERE id = @id;

-- name: CheckStationPin :one
-- Contrôle d'une épingle : dans le Bénin (marge de 2 km) ? À quelle distance de la position active
-- (-1 si la station n'est pas encore épinglée) ?
SELECT
  EXISTS (
    SELECT 1 FROM country_boundaries b
    WHERE b.code = 'BEN'
      AND ST_Covers(b.boundary_buffered, ST_SetSRID(ST_MakePoint(@lng::float8, @lat::float8), 4326)::geography)
  )::boolean AS inside_benin,
  COALESCE(ST_Distance(s.location, ST_SetSRID(ST_MakePoint(@lng::float8, @lat::float8), 4326)::geography), -1)::float8 AS move_m
FROM stations s
WHERE s.id = @station_id;

-- name: SetStationLocation :exec
UPDATE stations
SET location = ST_SetSRID(ST_MakePoint(@lng::float8, @lat::float8), 4326)::geography,
    location_set_at = now(), h3_r8 = @h3_r8
WHERE id = @id;

-- name: FlagStationLocation :exec
UPDATE stations
SET location_flagged_at = now(), location_flag_distance_m = @distance_m, location_flag_accuracy_m = sqlc.narg(accuracy_m)
WHERE id = @id;

-- name: ClearStationLocationFlag :exec
UPDATE stations
SET location_flagged_at = NULL, location_flag_distance_m = NULL, location_flag_accuracy_m = NULL
WHERE id = @id;

-- name: SupersedeLocationRequests :exec
UPDATE station_location_requests SET status = 'superseded'
WHERE station_id = @station_id AND status = 'pending';

-- name: CreateLocationRequest :one
INSERT INTO station_location_requests (station_id, requested_by, location, h3_r8, distance_m, device_distance_m, device_accuracy_m)
VALUES (@station_id, @requested_by, ST_SetSRID(ST_MakePoint(@lng::float8, @lat::float8), 4326)::geography,
        @h3_r8, @distance_m, sqlc.narg(device_distance_m), sqlc.narg(device_accuracy_m))
RETURNING id, created_at;

-- name: GetPendingLocationRequest :one
SELECT id, station_id, requested_by, lat, lng, h3_r8, distance_m, device_distance_m, device_accuracy_m, status, created_at
FROM station_location_requests
WHERE station_id = @station_id AND status = 'pending';

-- name: ApplyLocationRequest :execrows
-- Applique une demande en attente à la station (nouvelle position, nouvelle cellule H3).
UPDATE stations s
SET location = r.location, location_set_at = now(), h3_r8 = r.h3_r8
FROM station_location_requests r
WHERE r.id = @request_id AND r.station_id = s.id AND r.status = 'pending';

-- name: ResolveLocationRequest :execrows
UPDATE station_location_requests
SET status = @status, review_reason = sqlc.narg(reason), reviewed_by = @reviewed_by, reviewed_at = now()
WHERE id = @id AND station_id = @station_id AND status = 'pending';

-- name: TouchStationStockActivity :exec
UPDATE stations SET last_stock_update_at = now() WHERE id = @id;

-- name: GetStationContact :one
-- Destinataire des emails de statut.
SELECT s.id, s.name, s.status, u.id AS manager_id, u.email, u.first_name, u.email_verified_at
FROM stations s
JOIN users u ON u.id = s.manager_id
WHERE s.id = @id;

-- name: ListStationsForAdmin :many
-- Un dossier pending n'apparaît qu'une fois l'email du gérant vérifié (D5).
-- Filtres (étape 7) : statut (NULL = tous), fraîcheur de la dernière saisie ou confirmation
-- (stale : 8 à 24 h, expired : plus de 24 h ou jamais), gérant inactif (alerte ouverte), sans
-- horaires, signalée (effet de signalement en cours), exclue (seuil de 5 atteint, produit ou station).
-- Curseur (created_at, id) décroissants.
SELECT s.id, s.name, s.brand, s.ifu, s.city, s.status, s.version, s.created_at, s.updated_at,
       s.location_flagged_at, s.lat, s.lng, s.last_stock_update_at,
       (u.email_verified_at IS NOT NULL)::boolean AS manager_email_verified,
       EXISTS (SELECT 1 FROM station_location_requests r WHERE r.station_id = s.id AND r.status = 'pending')::boolean AS has_pending_move,
       EXISTS (SELECT 1 FROM station_opening_hours h WHERE h.station_id = s.id)::boolean AS has_opening_hours,
       EXISTS (SELECT 1 FROM station_report_flags f WHERE f.station_id = s.id)::boolean AS reported,
       EXISTS (SELECT 1 FROM station_report_flags f WHERE f.station_id = s.id AND f.excluded_at IS NOT NULL)::boolean AS excluded,
       EXISTS (SELECT 1 FROM admin_alerts a WHERE a.station_id = s.id AND a.kind = 'manager_inactive'
               AND a.resolved_at IS NULL)::boolean AS manager_inactive
FROM stations s
LEFT JOIN users u ON u.id = s.manager_id
WHERE (sqlc.narg(status)::station_status IS NULL OR s.status = sqlc.narg(status)::station_status)
  AND (s.status <> 'pending' OR u.email_verified_at IS NOT NULL)
  AND (sqlc.narg(query)::text IS NULL
       OR s.name ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\'
       OR s.ifu LIKE sqlc.narg(query)::text || '%' ESCAPE '\')
  AND (NOT @needs_review::boolean
       OR s.location_flagged_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM station_location_requests r WHERE r.station_id = s.id AND r.status = 'pending'))
  AND (sqlc.narg(freshness)::text IS NULL
       OR (sqlc.narg(freshness)::text = 'stale' AND s.last_stock_update_at <= @stale_since::timestamptz
           AND s.last_stock_update_at > @expired_since::timestamptz)
       OR (sqlc.narg(freshness)::text = 'expired'
           AND (s.last_stock_update_at IS NULL OR s.last_stock_update_at <= @expired_since::timestamptz)))
  AND (NOT @manager_inactive::boolean
       OR EXISTS (SELECT 1 FROM admin_alerts a WHERE a.station_id = s.id AND a.kind = 'manager_inactive' AND a.resolved_at IS NULL))
  AND (NOT @no_hours::boolean OR NOT EXISTS (SELECT 1 FROM station_opening_hours h WHERE h.station_id = s.id))
  AND (NOT @reported::boolean OR EXISTS (SELECT 1 FROM station_report_flags f WHERE f.station_id = s.id))
  AND (NOT @excluded::boolean
       OR EXISTS (SELECT 1 FROM station_report_flags f WHERE f.station_id = s.id AND f.excluded_at IS NOT NULL))
  AND (sqlc.narg(cursor_created_at)::timestamptz IS NULL
       OR (s.created_at, s.id) < (sqlc.narg(cursor_created_at)::timestamptz, sqlc.narg(cursor_id)::uuid))
ORDER BY s.created_at DESC, s.id DESC
LIMIT @page_size;

-- name: ListStationsForMap :many
-- Carte admin (GeoJSON léger, regroupement côté client) : stations épinglées.
SELECT s.id, s.name, s.status, s.lat, s.lng, s.last_stock_update_at,
       EXISTS (SELECT 1 FROM station_report_flags f WHERE f.station_id = s.id)::boolean AS reported
FROM stations s
WHERE s.location IS NOT NULL
  AND (sqlc.narg(status)::station_status IS NULL OR s.status = sqlc.narg(status)::station_status)
ORDER BY s.id;

-- name: GetStationForAdmin :one
SELECT s.id, s.status, s.version, s.name, s.brand, s.ifu, s.rccm, s.address, s.city, s.phone,
       s.lat, s.lng, s.h3_r8, s.location_set_at, s.location_flagged_at, s.location_flag_distance_m, s.location_flag_accuracy_m,
       s.status_reason, s.reviewed_by, s.reviewed_at, s.last_stock_update_at, s.document_mime, s.created_at, s.updated_at,
       s.status_changed_at, u.id AS manager_id, u.first_name AS manager_first_name, u.last_name AS manager_last_name,
       u.email AS manager_email, u.email_verified_at AS manager_email_verified_at
FROM stations s
LEFT JOIN users u ON u.id = s.manager_id
WHERE s.id = @id;
