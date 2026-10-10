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
UPDATE users SET last_login_at = now()
WHERE id = @id;

-- name: EnableUserTOTP :exec
UPDATE users SET totp_secret_encrypted = @secret, totp_enabled_at = now()
WHERE id = @id;

-- name: DisableUserTOTP :exec
UPDATE users SET totp_secret_encrypted = NULL, totp_enabled_at = NULL
WHERE id = @id;

-- name: AnonymizeUser :exec
-- Suppression de compte (étape 9 : purge définitive) : plus aucune donnée personnelle.
UPDATE users
SET email                 = @anonymized_email,
    first_name            = 'Deleted',
    last_name             = 'User',
    password_hash         = '!',
    status                = 'pending_deletion',
    email_verified_at     = NULL,
    totp_secret_encrypted = NULL,
    totp_enabled_at       = NULL,
    deletion_requested_at = now()
WHERE id = @id;

-- name: DeleteUserDeviceTokens :exec
DELETE FROM device_tokens WHERE user_id = @user_id;

-- name: DeleteUserFavorites :exec
DELETE FROM favorites WHERE user_id = @user_id;
