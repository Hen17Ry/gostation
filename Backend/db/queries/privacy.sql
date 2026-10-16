-- Étape 10A : demandes d'exercice des droits, export « mes données », effacement d'un compte.

-- name: InsertDataRequest :one
INSERT INTO data_requests (user_id, type, status, source, details, due_at, verified_at, handled_by, response_note, completed_at)
VALUES (@user_id, @type, @status, @source, sqlc.narg(details), @due_at, sqlc.narg(verified_at),
        sqlc.narg(handled_by), sqlc.narg(response_note), sqlc.narg(completed_at))
RETURNING id;

-- name: GetDataRequest :one
SELECT r.id, r.user_id, r.type, r.status, r.source, r.details, r.due_at, r.verified_at, r.handled_by,
       r.response_note, r.created_at, r.updated_at, r.completed_at, r.version,
       u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name,
       u.role AS user_role, u.status AS user_status,
       h.first_name AS handler_first_name, h.last_name AS handler_last_name
FROM data_requests r
LEFT JOIN users u ON u.id = r.user_id
LEFT JOIN users h ON h.id = r.handled_by
WHERE r.id = @id;

-- name: ListDataRequests :many
-- Liste admin, les plus récentes d'abord (curseur created_at, id). open_only : reçues ou en cours ;
-- overdue_only : ouvertes et échues.
SELECT r.id, r.user_id, r.type, r.status, r.source, r.due_at, r.verified_at, r.created_at, r.completed_at,
       u.email AS user_email, u.role AS user_role
FROM data_requests r
LEFT JOIN users u ON u.id = r.user_id
WHERE (sqlc.narg(type)::data_request_type IS NULL OR r.type = sqlc.narg(type)::data_request_type)
  AND (sqlc.narg(status)::data_request_status IS NULL OR r.status = sqlc.narg(status)::data_request_status)
  AND (NOT @open_only::boolean OR r.status IN ('pending', 'in_progress'))
  AND (NOT @overdue_only::boolean OR (r.status IN ('pending', 'in_progress') AND r.due_at < @now::timestamptz))
  AND (sqlc.narg(cursor_at)::timestamptz IS NULL
       OR (r.created_at, r.id) < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::uuid))
ORDER BY r.created_at DESC, r.id DESC
LIMIT @page_size;

-- name: ListUserDataRequests :many
SELECT id, type, status, source, due_at, created_at, completed_at, response_note
FROM data_requests
WHERE user_id = @user_id
ORDER BY created_at DESC
LIMIT 50;

-- name: DataRequestCounters :one
-- Badge et alerte de la barre latérale admin : demandes ouvertes, à échéance sous 7 jours, échues.
SELECT count(*) FILTER (WHERE status IN ('pending', 'in_progress'))::int AS open,
       count(*) FILTER (WHERE status IN ('pending', 'in_progress') AND due_at >= @now::timestamptz
                        AND due_at < @soon::timestamptz)::int AS due_soon,
       count(*) FILTER (WHERE status IN ('pending', 'in_progress') AND due_at < @now::timestamptz)::int AS overdue
FROM data_requests;

-- name: VerifyDataRequest :execrows
UPDATE data_requests
SET verified_at = @now, updated_at = @now, version = version + 1
WHERE id = @id AND version = @version AND verified_at IS NULL AND status IN ('pending', 'in_progress');

-- name: MarkDataRequestInProgress :execrows
-- Prise en charge par un admin (ou action exécutée : export, suppression).
UPDATE data_requests
SET status = 'in_progress', handled_by = @handled_by, updated_at = @now, version = version + 1
WHERE id = @id AND version = @version AND status IN ('pending', 'in_progress');

-- name: CloseDataRequest :execrows
UPDATE data_requests
SET status = @status, response_note = @response_note, handled_by = sqlc.narg(handled_by),
    completed_at = @now, updated_at = @now, version = version + 1
WHERE id = @id AND (sqlc.narg(version)::int IS NULL OR version = sqlc.narg(version)::int)
  AND status IN ('pending', 'in_progress');

-- name: ExportDataRequests :many
-- Jeu d'export admin « demandes » : le suivi seulement (ni email, ni précisions, ni réponse).
SELECT id, type, source, status, created_at, due_at, (verified_at IS NOT NULL)::boolean AS verified, completed_at,
       (status IN ('pending', 'in_progress') AND due_at < @now::timestamptz)::boolean AS overdue
FROM data_requests
WHERE created_at >= @since::timestamptz AND created_at < @until::timestamptz
ORDER BY created_at, id
LIMIT @max_rows;

-- name: InsertPersonalExport :one
INSERT INTO personal_exports (user_id, request_id)
VALUES (@user_id, sqlc.narg(request_id))
RETURNING id;

-- name: GetPersonalExport :one
SELECT id, user_id, request_id, status, object_key, wrapped_key, sha256, size_bytes, error,
       created_at, completed_at, expires_at
FROM personal_exports
WHERE id = @id;

-- name: GetLatestPersonalExport :one
SELECT id, user_id, request_id, status, object_key, wrapped_key, sha256, size_bytes, error,
       created_at, completed_at, expires_at
FROM personal_exports
WHERE user_id = @user_id
ORDER BY created_at DESC
LIMIT 1;

-- name: CompletePersonalExport :execrows
UPDATE personal_exports
SET status = 'ready', object_key = @object_key, wrapped_key = @wrapped_key, sha256 = @sha256,
    size_bytes = @size_bytes, completed_at = @now, expires_at = @expires_at
WHERE id = @id AND status = 'pending';

-- name: FailPersonalExport :execrows
UPDATE personal_exports SET status = 'failed', error = @error, completed_at = @now
WHERE id = @id AND status = 'pending';

-- name: ListExpiredPersonalExports :many
-- Fichiers prêts depuis plus de 24 h, demandes restées en attente ou échouées depuis plus d'une heure.
SELECT id, object_key
FROM personal_exports
WHERE (status = 'ready' AND expires_at <= @now::timestamptz)
   OR (status <> 'ready' AND created_at < @stale_before::timestamptz)
ORDER BY created_at
LIMIT @batch_size;

-- name: CountExpiredPersonalExports :one
SELECT count(*) FROM personal_exports
WHERE (status = 'ready' AND expires_at <= @now::timestamptz)
   OR (status <> 'ready' AND created_at < @stale_before::timestamptz);

-- name: ListUserPersonalExports :many
SELECT id, object_key FROM personal_exports WHERE user_id = @user_id;

-- name: DeletePersonalExport :exec
DELETE FROM personal_exports WHERE id = @id;

-- name: FindUserForDataRequest :one
-- Compte visé par une demande reçue par email (jamais un compte déjà supprimé).
SELECT id, role, status, email, first_name
FROM users
WHERE email = @email AND status <> 'pending_deletion';

-- name: GetUserContact :one
SELECT id, role, status, email, first_name FROM users WHERE id = @id;

-- Collecte « mes données » : une requête par catégorie de l'inventaire (docs/legal), chacune
-- renvoie du JSON (clés en camelCase, comme l'API).

-- name: CollectProfile :one
SELECT jsonb_build_object(
  'id', id, 'role', role, 'status', status, 'email', email, 'firstName', first_name, 'lastName', last_name,
  'emailVerifiedAt', email_verified_at, 'privacyPolicyVersion', privacy_policy_version,
  'privacyAcceptedAt', privacy_accepted_at, 'lastLoginAt', last_login_at, 'lastActiveAt', last_active_at,
  'passwordChangedAt', password_changed_at, 'twoFactorEnabledAt', totp_enabled_at,
  'reportingBannedAt', reporting_banned_at, 'reportingBanReason', reporting_ban_reason,
  'disabledAt', disabled_at, 'disabledReason', disabled_reason, 'createdAt', created_at, 'updatedAt', updated_at
)::jsonb AS data
FROM users WHERE id = @user_id;

-- name: CollectDevices :one
-- Le token push lui-même n'est pas exporté en entier (il suffit à envoyer des notifications).
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id', id, 'platform', platform, 'tokenEnd', right(token, 6), 'installId', install_id, 'language', language,
  'appVersion', app_version, 'createdAt', created_at, 'lastSeenAt', last_seen_at
) ORDER BY created_at), '[]')::jsonb AS data
FROM device_tokens WHERE user_id = @user_id;

-- name: CollectNotificationSettings :one
SELECT COALESCE(jsonb_agg(jsonb_build_object('type', type, 'disabledAt', created_at) ORDER BY type), '[]')::jsonb AS data
FROM notification_opt_outs WHERE user_id = @user_id;

-- name: CollectNotifications :one
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id', id, 'type', type, 'data', data, 'createdAt', created_at, 'readAt', read_at, 'pushedAt', pushed_at
) ORDER BY created_at DESC), '[]')::jsonb AS data
FROM notifications WHERE user_id = @user_id;

-- name: CollectFavorites :one
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'stationId', f.station_id, 'stationName', s.name, 'addedAt', f.created_at,
  'alerts', COALESCE((SELECT jsonb_agg(jsonb_build_object('product', p.code, 'since', a.created_at) ORDER BY p.sort_order)
                      FROM favorite_alerts a JOIN products p ON p.id = a.product_id
                      WHERE a.user_id = f.user_id AND a.station_id = f.station_id), '[]')
) ORDER BY f.created_at), '[]')::jsonb AS data
FROM favorites f JOIN stations s ON s.id = f.station_id
WHERE f.user_id = @user_id;

-- name: CollectBackInStockAlerts :one
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'stationId', a.station_id, 'product', p.code, 'status', a.status, 'createdAt', a.created_at, 'sentAt', a.sent_at
) ORDER BY a.created_at DESC), '[]')::jsonb AS data
FROM back_in_stock_alerts a JOIN products p ON p.id = a.product_id
WHERE a.user_id = @user_id;

-- name: CollectReports :one
-- Signalements encore rattachés au compte (au-delà de 90 jours, l'auteur est pseudonymisé).
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id', r.id, 'stationId', r.station_id, 'stationName', s.name, 'reason', r.reason, 'product', p.code,
  'comment', r.comment, 'status', r.status, 'createdAt', r.created_at, 'resolvedAt', r.resolved_at
) ORDER BY r.created_at DESC), '[]')::jsonb AS data
FROM reports r JOIN stations s ON s.id = r.station_id LEFT JOIN products p ON p.id = r.product_id
WHERE r.reporter_id = @user_id;

-- name: CollectDataRequests :one
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id', id, 'type', type, 'source', source, 'status', status, 'details', details, 'createdAt', created_at,
  'dueAt', due_at, 'verifiedAt', verified_at, 'completedAt', completed_at, 'response', response_note
) ORDER BY created_at DESC), '[]')::jsonb AS data
FROM data_requests WHERE user_id = @user_id;

-- name: CollectAuditTrail :one
-- Actions du compte au journal d'audit (connexions, changements de mot de passe, demandes…).
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'action', action, 'entityType', entity_type, 'entityId', entity_id, 'metadata', metadata, 'at', created_at
) ORDER BY created_at DESC), '[]')::jsonb AS data
FROM audit_logs WHERE actor_id = @user_id;

-- name: CollectManagedStation :one
-- Station du gérant (V1 : une seule), avec ses horaires, fermetures, produits et stocks, ses
-- demandes de déplacement et l'historique des stocks saisi par le gérant.
SELECT jsonb_build_object(
  'id', s.id, 'status', s.status, 'statusReason', s.status_reason, 'name', s.name, 'brand', s.brand,
  'ifu', s.ifu, 'rccm', s.rccm, 'address', s.address, 'city', s.city, 'phone', s.phone,
  'location', CASE WHEN s.lat IS NULL THEN NULL ELSE jsonb_build_object('lat', s.lat, 'lng', s.lng) END,
  'locationSetAt', s.location_set_at, 'createdAt', s.created_at, 'updatedAt', s.updated_at,
  'document', CASE WHEN s.document_object_key IS NULL THEN NULL
                   ELSE jsonb_build_object('mimeType', s.document_mime, 'sha256', encode(s.document_sha256, 'hex')) END,
  'documentDeletedAt', s.document_deleted_at,
  'openingHours', COALESCE((SELECT jsonb_agg(jsonb_build_object('weekday', h.weekday, 'opensAt', h.opens_at, 'closesAt', h.closes_at)
                                             ORDER BY h.weekday, h.opens_at)
                            FROM station_opening_hours h WHERE h.station_id = s.id), '[]'),
  'closures', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', c.closed_on, 'reason', c.reason, 'createdAt', c.created_at)
                                         ORDER BY c.closed_on)
                        FROM station_closures c WHERE c.station_id = s.id), '[]'),
  'stocks', COALESCE((SELECT jsonb_agg(jsonb_build_object('product', p.code, 'quantity', st.quantity, 'updatedAt', st.updated_at,
                                                          'lastConfirmedAt', st.last_confirmed_at) ORDER BY p.sort_order)
                      FROM station_stocks st JOIN products p ON p.id = st.product_id WHERE st.station_id = s.id), '[]'),
  'locationRequests', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', l.status, 'lat', l.lat, 'lng', l.lng,
                                                                    'distanceMeters', l.distance_m, 'createdAt', l.created_at,
                                                                    'reviewedAt', l.reviewed_at, 'reviewReason', l.review_reason)
                                                 ORDER BY l.created_at DESC)
                                FROM station_location_requests l WHERE l.station_id = s.id AND l.requested_by = @user_id), '[]'),
  'stockHistory', COALESCE((SELECT jsonb_agg(jsonb_build_object('product', p.code, 'quantity', h.quantity,
                                                                'previousQuantity', h.previous_quantity, 'at', h.created_at)
                                             ORDER BY h.created_at DESC)
                            FROM stock_history h JOIN products p ON p.id = h.product_id
                            WHERE h.station_id = s.id AND h.changed_by = @user_id), '[]')
)::jsonb AS data
FROM stations s
WHERE s.manager_id = @user_id;

-- name: GetManagedStationDocument :one
SELECT id, document_object_key, document_wrapped_key, document_sha256, document_mime
FROM stations
WHERE manager_id = @user_id AND document_object_key IS NOT NULL;

-- name: PseudonymizeUserReports :execrows
-- Effacement d'un compte : ses signalements gardent le pseudonyme de l'auteur, plus son compte.
UPDATE reports
SET reporter_id = NULL, reporter_pseudonym = @pseudonym, pseudonymized_at = @now
WHERE reporter_id = @user_id;

-- name: DetachManagedStation :many
-- Effacement du compte d'un gérant : station approuvée ou en attente suspendue (retirée de la
-- recherche et de la file de revue), lien avec le compte rompu ; la conservation du justificatif
-- court à partir de manager_deleted_at.
UPDATE stations
SET status = CASE WHEN status IN ('approved', 'pending') THEN 'suspended'::station_status ELSE status END,
    status_reason = CASE WHEN status IN ('approved', 'pending') THEN @reason ELSE status_reason END,
    manager_id = NULL, manager_deleted_at = @now, version = version + 1
WHERE manager_id = @user_id
RETURNING id, status;
