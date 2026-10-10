-- name: InsertRecoveryCodes :copyfrom
INSERT INTO admin_recovery_codes (user_id, code_hash) VALUES (@user_id, @code_hash);

-- name: DeleteRecoveryCodes :exec
DELETE FROM admin_recovery_codes WHERE user_id = @user_id;

-- name: UseRecoveryCode :one
-- Consomme un code de secours (usage unique).
UPDATE admin_recovery_codes SET used_at = now()
WHERE user_id = @user_id AND code_hash = @code_hash AND used_at IS NULL
RETURNING id;

-- name: CountUnusedRecoveryCodes :one
SELECT count(*) FROM admin_recovery_codes
WHERE user_id = @user_id AND used_at IS NULL;
