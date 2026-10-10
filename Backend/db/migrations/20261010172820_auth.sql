-- Authentification : 2FA TOTP des admins (secret chiffré, AES-256-GCM), date de changement
-- du mot de passe, codes de secours hachés. Les sessions et refresh tokens vivent dans Redis.

-- +goose Up
ALTER TABLE users
  ADD COLUMN password_changed_at    timestamptz,
  ADD COLUMN totp_secret_encrypted  bytea,
  ADD COLUMN totp_enabled_at        timestamptz,
  ADD CONSTRAINT ck_users_totp CHECK ((totp_secret_encrypted IS NULL) = (totp_enabled_at IS NULL));

-- 10 codes par admin, SHA-256 de codes à 80 bits d'entropie (pas besoin d'argon2).
CREATE TABLE admin_recovery_codes (
  id          uuid        NOT NULL DEFAULT uuidv7(),
  user_id     uuid        NOT NULL,
  code_hash   bytea       NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_admin_recovery_codes PRIMARY KEY (id),
  CONSTRAINT fk_admin_recovery_codes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT uq_admin_recovery_codes_code UNIQUE (user_id, code_hash)
);

-- +goose Down
DROP TABLE IF EXISTS admin_recovery_codes;
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS ck_users_totp,
  DROP COLUMN IF EXISTS totp_enabled_at,
  DROP COLUMN IF EXISTS totp_secret_encrypted,
  DROP COLUMN IF EXISTS password_changed_at;
