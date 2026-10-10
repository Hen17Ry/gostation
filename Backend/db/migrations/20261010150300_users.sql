-- Comptes des trois rôles. Aucune position, aucun téléphone personnel.

-- +goose Up
CREATE TABLE users (
  id                      uuid        NOT NULL DEFAULT uuidv7(),
  role                    user_role   NOT NULL DEFAULT 'user',
  status                  user_status NOT NULL DEFAULT 'active',
  email                   citext      NOT NULL,
  password_hash           text        NOT NULL,
  first_name              text        NOT NULL,
  last_name               text        NOT NULL,
  email_verified_at       timestamptz,
  privacy_policy_version  text        NOT NULL,
  privacy_accepted_at     timestamptz NOT NULL,
  last_login_at           timestamptz,
  deletion_requested_at   timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_users PRIMARY KEY (id),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT ck_users_first_name CHECK (char_length(first_name) BETWEEN 1 AND 100),
  CONSTRAINT ck_users_last_name  CHECK (char_length(last_name)  BETWEEN 1 AND 100)
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS users;
