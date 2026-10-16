-- name: CreateUser :one
INSERT INTO users (role, email, password_hash, first_name, last_name, privacy_policy_version, privacy_accepted_at)
VALUES (@role, @email, @password_hash, @first_name, @last_name, @privacy_policy_version, now())
RETURNING id, created_at;

-- name: GetUserByEmail :one
-- Lecture pour le login : le hash du mot de passe ne sort jamais du paquet auth.
SELECT id, role, status, email, password_hash, email_verified_at, totp_secret_encrypted, totp_enabled_at
FROM users
WHERE email = @email;

-- name: GetUserByID :one
SELECT id, role, status, email, first_name, last_name, email_verified_at, privacy_policy_version,
       privacy_accepted_at, totp_enabled_at, password_changed_at, last_login_at, created_at
FROM users
WHERE id = @id;

-- name: GetUserCredentials :one
SELECT id, role, status, email, password_hash, totp_secret_encrypted
FROM users
WHERE id = @id;

-- name: GetUserAccess :one
-- État lu par les middlewares (email vérifié, compte actif).
SELECT role, status, email_verified_at
FROM users
WHERE id = @id;

-- name: MarkEmailVerified :exec
UPDATE users SET email_verified_at = now()
WHERE id = @id AND email_verified_at IS NULL;

-- name: UpdateUserPassword :exec
UPDATE users SET password_hash = @password_hash, password_changed_at = now()
WHERE id = @id;

-- name: RehashUserPassword :exec
-- Mise à niveau des paramètres argon2 au login : ne touche pas password_changed_at.
UPDATE users SET password_hash = @password_hash
WHERE id = @id;

-- name: UpdateUserProfile :exec
UPDATE users
SET first_name = COALESCE(sqlc.narg(first_name), first_name),
    last_name  = COALESCE(sqlc.narg(last_name), last_name)
WHERE id = @id;

-- name: AcceptPrivacyPolicy :exec
UPDATE users SET privacy_policy_version = @version, privacy_accepted_at = now()
WHERE id = @id;

-- name: TouchLastLogin :exec
-- Une connexion compte comme activité et annule l'avertissement d'inactivité.
UPDATE users SET last_login_at = now(), last_active_at = now(), inactivity_warned_at = NULL
WHERE id = @id;

-- name: TouchLastActive :exec
-- Renouvellement de session : activité, au plus une écriture par heure (ou aussitôt si le compte
-- avait été prévenu de sa suppression pour inactivité).
UPDATE users SET last_active_at = now(), inactivity_warned_at = NULL
WHERE id = @id AND (last_active_at < now() - interval '1 hour' OR inactivity_warned_at IS NOT NULL);

-- name: EnableUserTOTP :exec
UPDATE users SET totp_secret_encrypted = @secret, totp_enabled_at = now()
WHERE id = @id;

-- name: DisableUserTOTP :exec
UPDATE users SET totp_secret_encrypted = NULL, totp_enabled_at = NULL
WHERE id = @id;

-- name: AnonymizeUser :exec
-- Suppression de compte : plus aucune donnée personnelle, motifs libres de l'admin compris (un
-- compte désactivé perd aussi sa désactivation, ck_users_disabled n'admettant pas pending_deletion).
UPDATE users
SET email                 = @anonymized_email,
    first_name            = 'Deleted',
    last_name             = 'User',
    password_hash         = '!',
    status                = 'pending_deletion',
    email_verified_at     = NULL,
    totp_secret_encrypted = NULL,
    totp_enabled_at       = NULL,
    disabled_at           = NULL,
    disabled_reason       = NULL,
    reporting_banned_at   = NULL,
    reporting_ban_reason  = NULL,
    inactivity_warned_at  = NULL,
    deletion_requested_at = now()
WHERE id = @id;

-- name: DeleteUserDeviceTokens :exec
DELETE FROM device_tokens WHERE user_id = @user_id;

-- name: DeleteUserFavorites :exec
DELETE FROM favorites WHERE user_id = @user_id;

-- name: ListUsersForAdmin :many
-- Liste admin des comptes, les plus récents d'abord (curseur created_at, id). La recherche porte
-- sur l'email, le prénom, le nom et « prénom nom ».
SELECT u.id, u.role, u.status, u.email, u.first_name, u.last_name, u.email_verified_at,
       u.last_login_at, u.disabled_at, u.reporting_banned_at, u.created_at
FROM users u
WHERE (sqlc.narg(role)::user_role IS NULL OR u.role = sqlc.narg(role)::user_role)
  AND (sqlc.narg(status)::user_status IS NULL OR u.status = sqlc.narg(status)::user_status)
  AND (sqlc.narg(email_verified)::boolean IS NULL OR (u.email_verified_at IS NOT NULL) = sqlc.narg(email_verified)::boolean)
  AND (sqlc.narg(query)::text IS NULL
       OR u.email::text ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\'
       OR u.first_name ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\'
       OR u.last_name ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\'
       OR (u.first_name || ' ' || u.last_name) ILIKE '%' || sqlc.narg(query)::text || '%' ESCAPE '\')
  AND (sqlc.narg(cursor_created_at)::timestamptz IS NULL
       OR (u.created_at, u.id) < (sqlc.narg(cursor_created_at)::timestamptz, sqlc.narg(cursor_id)::uuid))
ORDER BY u.created_at DESC, u.id DESC
LIMIT @page_size;

-- name: GetUserForAdmin :one
SELECT u.id, u.role, u.status, u.email, u.first_name, u.last_name, u.email_verified_at,
       u.privacy_policy_version, u.privacy_accepted_at, u.last_login_at, u.password_changed_at, u.totp_enabled_at,
       u.disabled_at, u.disabled_reason, u.reporting_banned_at, u.reporting_ban_reason, u.deletion_requested_at,
       u.created_at, u.updated_at,
       (SELECT count(*) FROM reports r WHERE r.reporter_id = u.id)::int AS reports_total,
       (SELECT count(*) FROM reports r WHERE r.reporter_id = u.id AND r.abusive)::int AS reports_abusive,
       (SELECT count(*) FROM favorites f WHERE f.user_id = u.id)::int AS favorites,
       (SELECT count(*) FROM device_tokens d WHERE d.user_id = u.id)::int AS devices,
       s.id AS station_id, s.name AS station_name, s.status AS station_status
FROM users u
LEFT JOIN stations s ON s.manager_id = u.id
WHERE u.id = @id;

-- name: DisableUser :execrows
-- Les comptes admin se gèrent par la CLI : jamais désactivés ici.
UPDATE users SET status = 'disabled', disabled_at = now(), disabled_reason = @reason
WHERE id = @id AND status = 'active' AND role <> 'admin';

-- name: ReactivateUser :execrows
UPDATE users SET status = 'active', disabled_at = NULL, disabled_reason = NULL
WHERE id = @id AND status = 'disabled';
