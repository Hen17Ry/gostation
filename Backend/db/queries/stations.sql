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
SELECT id, manager_id, status, name, brand, ifu, rccm, address, city, phone,
       lat, lng, location_set_at, status_reason, reviewed_at, last_stock_update_at, created_at, updated_at
FROM stations
WHERE manager_id = @manager_id;

-- name: GetStationDocument :one
-- Métadonnées du justificatif chiffré : lecture réservée aux admins.
SELECT id, document_object_key, document_wrapped_key, document_sha256, document_mime
FROM stations
WHERE id = @id;

-- name: SuspendManagerStation :exec
UPDATE stations SET status = 'suspended', status_reason = @reason
WHERE manager_id = @manager_id AND status <> 'rejected';
