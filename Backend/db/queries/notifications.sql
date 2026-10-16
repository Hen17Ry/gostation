-- Notifications (étape 6) : appareils, boîte de réception, préférences.

-- name: DeleteDeviceTokenElsewhere :exec
-- Un token Expo n'appartient qu'à une installation : il quitte l'ancienne s'il change de main.
DELETE FROM device_tokens WHERE token = @token AND install_id <> @install_id;

-- name: UpsertDevice :one
-- Une installation = une ligne. La réenregistrer (lancement de l'app, nouveau token, autre compte,
-- nouvelle session) la met à jour et repousse last_seen_at.
INSERT INTO device_tokens (user_id, token, platform, app_version, session_id, install_id, language, last_seen_at)
VALUES (@user_id, @token, @platform, sqlc.narg(app_version), @session_id, @install_id, @language, now())
ON CONFLICT (install_id) DO UPDATE
SET user_id = EXCLUDED.user_id, token = EXCLUDED.token, platform = EXCLUDED.platform,
    app_version = EXCLUDED.app_version, session_id = EXCLUDED.session_id,
    language = EXCLUDED.language, last_seen_at = now()
RETURNING id, platform, language, app_version, created_at, last_seen_at;

-- name: DeleteDevice :execrows
DELETE FROM device_tokens WHERE id = @id AND user_id = @user_id;

-- name: DeleteDevicesBySession :execrows
-- Révocation d'une session (logout, révocation, changement de mot de passe…).
DELETE FROM device_tokens WHERE session_id = @session_id;

-- name: DeleteDeviceIfToken :execrows
-- DeviceNotRegistered : on ne supprime la ligne que si elle porte encore le token signalé
-- (empreinte SHA-256), l'installation ayant pu se réenregistrer entre-temps.
DELETE FROM device_tokens
WHERE id = @id AND encode(sha256(convert_to(token, 'UTF8')), 'hex') = @token_hash::text;

-- name: DeleteDevicesByID :execrows
DELETE FROM device_tokens WHERE id = ANY(@ids::uuid[]);

-- name: ListDevicesForUsers :many
SELECT id, user_id, token, session_id, language, platform
FROM device_tokens
WHERE user_id = ANY(@user_ids::uuid[])
ORDER BY user_id, id;

-- name: InsertNotification :one
-- Rien n'est créé si l'utilisateur a désactivé ce type (opt-out) ou si son compte n'est plus actif.
INSERT INTO notifications (user_id, type, data)
SELECT @user_id::uuid, @type::notification_type, @data::jsonb
WHERE NOT EXISTS (SELECT 1 FROM notification_opt_outs o WHERE o.user_id = @user_id::uuid AND o.type = @type::notification_type)
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = @user_id::uuid AND u.status = 'active')
RETURNING id;

-- name: ListNotificationsToPush :many
SELECT id, user_id, type, data
FROM notifications
WHERE id = ANY(@ids::uuid[]) AND pushed_at IS NULL
ORDER BY id;

-- name: MarkNotificationsPushed :exec
UPDATE notifications SET pushed_at = now() WHERE id = ANY(@ids::uuid[]) AND pushed_at IS NULL;

-- name: ListNotifications :many
-- Boîte de réception, du plus récent au plus ancien (id UUIDv7), pagination par curseur.
SELECT id, type, data, created_at, read_at
FROM notifications
WHERE user_id = @user_id AND (sqlc.narg(cursor)::uuid IS NULL OR id < sqlc.narg(cursor)::uuid)
ORDER BY id DESC
LIMIT @page_size;

-- name: CountUnreadNotifications :one
SELECT count(*) FROM notifications WHERE user_id = @user_id AND read_at IS NULL;

-- name: MarkNotificationsRead :execrows
UPDATE notifications SET read_at = now()
WHERE user_id = @user_id AND read_at IS NULL AND (@all_unread::boolean OR id = ANY(@ids::uuid[]));

-- name: ListNotificationOptOuts :many
SELECT type FROM notification_opt_outs WHERE user_id = @user_id ORDER BY type;

-- name: AddNotificationOptOut :exec
INSERT INTO notification_opt_outs (user_id, type) VALUES (@user_id, @type) ON CONFLICT DO NOTHING;

-- name: RemoveNotificationOptOut :exec
DELETE FROM notification_opt_outs WHERE user_id = @user_id AND type = @type;

-- name: DeleteUserNotifications :exec
DELETE FROM notifications WHERE user_id = @user_id;

-- name: DeleteUserNotificationOptOuts :exec
DELETE FROM notification_opt_outs WHERE user_id = @user_id;
