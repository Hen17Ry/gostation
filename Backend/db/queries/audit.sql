-- name: InsertAuditLog :exec
INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, metadata, request_id)
VALUES (sqlc.narg(actor_id), sqlc.narg(actor_role), @action, @entity_type, sqlc.narg(entity_id), @metadata, sqlc.narg(request_id));

-- name: ListAuditLogsByEntity :many
-- Lecture pour les tests.
SELECT id, actor_id, actor_role, action, entity_type, entity_id, metadata, request_id, created_at
FROM audit_logs
WHERE entity_type = @entity_type AND entity_id = @entity_id
ORDER BY id;

-- name: ListAuditLogs :many
-- Journal d'audit (admin, lecture seule) : filtres par acteur, action (exacte ou préfixe « admin. »),
-- cible et période ; curseur (created_at, id) décroissants.
SELECT a.id, a.actor_id, a.actor_role, a.action, a.entity_type, a.entity_id, a.metadata, a.request_id, a.created_at,
       u.first_name AS actor_first_name, u.last_name AS actor_last_name, u.email AS actor_email
FROM audit_logs a
LEFT JOIN users u ON u.id = a.actor_id
WHERE (sqlc.narg(actor_id)::uuid IS NULL OR a.actor_id = sqlc.narg(actor_id)::uuid)
  AND (sqlc.narg(action)::text IS NULL OR a.action = sqlc.narg(action)::text)
  AND (sqlc.narg(action_prefix)::text IS NULL OR a.action LIKE sqlc.narg(action_prefix)::text || '%' ESCAPE '\')
  AND (sqlc.narg(entity_type)::text IS NULL OR a.entity_type = sqlc.narg(entity_type)::text)
  AND (sqlc.narg(entity_id)::text IS NULL OR a.entity_id = sqlc.narg(entity_id)::text)
  AND (sqlc.narg(since)::timestamptz IS NULL OR a.created_at >= sqlc.narg(since)::timestamptz)
  AND (sqlc.narg(until)::timestamptz IS NULL OR a.created_at < sqlc.narg(until)::timestamptz)
  AND (sqlc.narg(cursor_created_at)::timestamptz IS NULL
       OR (a.created_at, a.id) < (sqlc.narg(cursor_created_at)::timestamptz, sqlc.narg(cursor_id)::bigint))
ORDER BY a.created_at DESC, a.id DESC
LIMIT @page_size;

-- name: ExportAuditLogs :many
SELECT id, actor_id, actor_role, action, entity_type, entity_id, metadata, request_id, created_at
FROM audit_logs
WHERE created_at >= @since::timestamptz AND created_at < @until::timestamptz
ORDER BY created_at, id
LIMIT @max_rows;
