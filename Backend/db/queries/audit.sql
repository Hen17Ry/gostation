-- name: InsertAuditLog :exec
INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, metadata, request_id)
VALUES (sqlc.narg(actor_id), sqlc.narg(actor_role), @action, @entity_type, sqlc.narg(entity_id), @metadata, sqlc.narg(request_id));

-- name: ListAuditLogsByEntity :many
-- Lecture pour les tests et, plus tard, l'écran d'audit admin.
SELECT id, actor_id, actor_role, action, entity_type, entity_id, metadata, request_id, created_at
FROM audit_logs
WHERE entity_type = @entity_type AND entity_id = @entity_id
ORDER BY id;
