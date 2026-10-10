-- Tokens push Expo. Supprimés à la déconnexion, sur DeviceNotRegistered, ou après 90 j d'inactivité.

-- +goose Up
CREATE TABLE device_tokens (
  id            uuid            NOT NULL DEFAULT uuidv7(),
  user_id       uuid            NOT NULL,
  token         text            NOT NULL,
  platform      device_platform NOT NULL,
  app_version   text,
  last_seen_at  timestamptz     NOT NULL DEFAULT now(),
  created_at    timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT pk_device_tokens PRIMARY KEY (id),
  CONSTRAINT fk_device_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT uq_device_tokens_token UNIQUE (token)
);

CREATE INDEX idx_device_tokens_user ON device_tokens (user_id);

-- +goose Down
DROP TABLE IF EXISTS device_tokens;
