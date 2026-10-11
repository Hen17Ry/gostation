-- Exports admin (étape 7) : demandés par l'API, générés par le worker (tâche export:generate),
-- fichiers chiffrés supprimés 24 h après leur génération (tâche export:purge).

-- name: CreateExport :one
INSERT INTO exports (requested_by, dataset, format, params)
VALUES (@requested_by, @dataset, @format, @params)
RETURNING id;

-- name: GetExport :one
SELECT e.id, e.requested_by, e.dataset, e.format, e.params, e.status, e.object_key, e.wrapped_key, e.sha256,
       e.size_bytes, e.row_count, e.error, e.created_at, e.completed_at, e.expires_at,
       u.first_name AS requested_by_first_name, u.last_name AS requested_by_last_name
FROM exports e
LEFT JOIN users u ON u.id = e.requested_by
WHERE e.id = @id;

-- name: ListExports :many
SELECT e.id, e.requested_by, e.dataset, e.format, e.params, e.status, e.object_key, e.wrapped_key, e.sha256,
       e.size_bytes, e.row_count, e.error, e.created_at, e.completed_at, e.expires_at,
       u.first_name AS requested_by_first_name, u.last_name AS requested_by_last_name
FROM exports e
LEFT JOIN users u ON u.id = e.requested_by
WHERE sqlc.narg(cursor)::uuid IS NULL OR e.id < sqlc.narg(cursor)::uuid
ORDER BY e.id DESC
LIMIT @page_size;

-- name: CompleteExport :execrows
UPDATE exports
SET status = 'ready', object_key = @object_key, wrapped_key = @wrapped_key, sha256 = @sha256,
    size_bytes = @size_bytes, row_count = @row_count, completed_at = now(), expires_at = @expires_at
WHERE id = @id AND status = 'pending';

-- name: FailExport :execrows
UPDATE exports SET status = 'failed', error = @error, completed_at = now()
WHERE id = @id AND status = 'pending';

-- name: FailStalePendingExports :execrows
-- Une demande toujours en attente après 1 h (tâche perdue) est déclarée échouée.
UPDATE exports SET status = 'failed', error = @error, completed_at = now()
WHERE status = 'pending' AND created_at < @before::timestamptz;

-- name: ListExpiredExports :many
SELECT id, object_key FROM exports
WHERE status = 'ready' AND expires_at <= @now::timestamptz
ORDER BY expires_at
LIMIT 500;

-- name: ExpireExport :execrows
UPDATE exports SET status = 'expired', object_key = NULL, wrapped_key = NULL
WHERE id = @id AND status = 'ready';

-- name: ExportStations :many
SELECT id, status, name, brand, ifu, rccm, address, city, phone, lat, lng,
       created_at, status_changed_at, last_stock_update_at
FROM stations
ORDER BY created_at, id
LIMIT @max_rows;

-- name: ExportStocks :many
SELECT s.id AS station_id, s.name AS station_name, s.status AS station_status, p.code AS product_code,
       p.label_fr AS product_label, p.unit, ss.quantity, ss.updated_at, ss.last_confirmed_at,
       GREATEST(ss.updated_at, ss.last_confirmed_at)::timestamptz AS fresh_at
FROM station_stocks ss
JOIN stations s ON s.id = ss.station_id
JOIN products p ON p.id = ss.product_id AND p.is_active
ORDER BY s.created_at, s.id, p.sort_order, p.id
LIMIT @max_rows;

-- name: ExportReports :many
-- L'auteur sort pseudonymisé par le service (reporter_id ne quitte jamais le serveur, l'email
-- n'est jamais lu).
SELECT r.id, r.created_at, r.station_id, s.name AS station_name, r.reason, p.code AS product_code,
       r.comment, r.status, r.abusive, r.resolved_at, r.resolution_note, r.reporter_id
FROM reports r
JOIN stations s ON s.id = r.station_id
LEFT JOIN products p ON p.id = r.product_id
WHERE r.created_at >= @since::timestamptz AND r.created_at < @until::timestamptz
ORDER BY r.created_at, r.id
LIMIT @max_rows;
