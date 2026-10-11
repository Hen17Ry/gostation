-- Notifications (étape 6) :
--   * device_tokens lié à la session qui l'a enregistré : la révocation de la session (logout,
--     révocation, changement de mot de passe…) supprime le token ;
--   * boîte de réception (conservation 30 jours, purge par le worker) ;
--   * préférences par type (opt-out : une ligne = type désactivé).

-- +goose Up
-- Aucune route n'écrivait encore dans device_tokens : la table est vide, les colonnes
-- obligatoires s'ajoutent sans valeur par défaut.
DELETE FROM device_tokens;

ALTER TABLE device_tokens
  ADD COLUMN session_id  text NOT NULL,
  ADD COLUMN install_id  uuid NOT NULL,
  ADD COLUMN language    text NOT NULL DEFAULT 'fr',
  ADD CONSTRAINT uq_device_tokens_install UNIQUE (install_id),
  ADD CONSTRAINT ck_device_tokens_language CHECK (language IN ('fr', 'en')),
  ADD CONSTRAINT ck_device_tokens_token CHECK (char_length(token) <= 255);

CREATE INDEX idx_device_tokens_session ON device_tokens (session_id);
CREATE INDEX idx_device_tokens_last_seen ON device_tokens (last_seen_at);

CREATE TYPE notification_type AS ENUM ('stock_reminder', 'station_reported', 'back_in_stock');

CREATE TABLE notifications (
  id          uuid              NOT NULL DEFAULT uuidv7(),
  user_id     uuid              NOT NULL,
  type        notification_type NOT NULL,
  data        jsonb             NOT NULL DEFAULT '{}',   -- paramètres d'affichage, jamais de position
  created_at  timestamptz       NOT NULL DEFAULT now(),
  read_at     timestamptz,
  pushed_at   timestamptz,                               -- push remis à Expo (idempotence des retries)
  CONSTRAINT pk_notifications PRIMARY KEY (id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Boîte de réception : id (UUIDv7) décroissant = du plus récent au plus ancien.
CREATE INDEX idx_notifications_user ON notifications (user_id, id DESC);
CREATE INDEX idx_notifications_unread ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_created ON notifications (created_at);

CREATE TABLE notification_opt_outs (
  user_id     uuid              NOT NULL,
  type        notification_type NOT NULL,
  created_at  timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT pk_notification_opt_outs PRIMARY KEY (user_id, type),
  CONSTRAINT fk_notification_opt_outs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- +goose Down
DROP TABLE IF EXISTS notification_opt_outs;
DROP TABLE IF EXISTS notifications;
DROP TYPE IF EXISTS notification_type;
DROP INDEX IF EXISTS idx_device_tokens_last_seen;
DROP INDEX IF EXISTS idx_device_tokens_session;
ALTER TABLE device_tokens
  DROP CONSTRAINT IF EXISTS ck_device_tokens_token,
  DROP CONSTRAINT IF EXISTS ck_device_tokens_language,
  DROP CONSTRAINT IF EXISTS uq_device_tokens_install,
  DROP COLUMN IF EXISTS language,
  DROP COLUMN IF EXISTS install_id,
  DROP COLUMN IF EXISTS session_id;
