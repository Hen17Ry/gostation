-- Étape 10A : droits des personnes (demandes, export personnel, suppression) et durées de
-- conservation (comptes inactifs, signalements, justificatifs, historique des stocks).

-- +goose Up
ALTER TYPE data_request_type ADD VALUE IF NOT EXISTS 'other';
ALTER TYPE export_dataset ADD VALUE IF NOT EXISTS 'data_requests';
CREATE TYPE data_request_source    AS ENUM ('app', 'email');
CREATE TYPE personal_export_status AS ENUM ('pending', 'ready', 'failed');

-- Demandes d'exercice des droits. Une demande reçue par email n'est traitée qu'une fois l'identité
-- confirmée par un code envoyé à l'adresse du compte (verified_at) ; une demande faite depuis
-- l'app, connecté, l'est d'office. L'export n'est plus rangé ici (personal_exports).
ALTER TABLE data_requests
  DROP COLUMN export_object_key,
  ADD COLUMN source      data_request_source NOT NULL DEFAULT 'app',
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN version     integer     NOT NULL DEFAULT 1,
  ADD CONSTRAINT ck_data_requests_rejected_note
    CHECK (status <> 'rejected' OR (response_note IS NOT NULL AND char_length(response_note) >= 3)),
  ADD CONSTRAINT ck_data_requests_closed_at
    CHECK ((status IN ('completed', 'rejected')) = (completed_at IS NOT NULL));
CREATE INDEX idx_data_requests_user ON data_requests (user_id, created_at DESC);
CREATE INDEX idx_data_requests_created ON data_requests (created_at DESC, id DESC);

-- Exports « mes données » : JSON chiffré (enveloppe, comme les justificatifs), téléchargeable
-- 24 h par la personne seule, via un lien signé ; supprimé ensuite (ligne et fichier).
CREATE TABLE personal_exports (
  id           uuid                   NOT NULL DEFAULT uuidv7(),
  user_id      uuid                   NOT NULL,
  request_id   uuid,
  status       personal_export_status NOT NULL DEFAULT 'pending',
  object_key   text,
  wrapped_key  bytea,
  sha256       bytea,
  size_bytes   bigint,
  error        text,
  created_at   timestamptz            NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at   timestamptz,
  CONSTRAINT pk_personal_exports PRIMARY KEY (id),
  CONSTRAINT fk_personal_exports_user    FOREIGN KEY (user_id)    REFERENCES users (id)         ON DELETE CASCADE,
  CONSTRAINT fk_personal_exports_request FOREIGN KEY (request_id) REFERENCES data_requests (id) ON DELETE SET NULL,
  CONSTRAINT ck_personal_exports_ready
    CHECK (status <> 'ready' OR (object_key IS NOT NULL AND wrapped_key IS NOT NULL AND sha256 IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE INDEX idx_personal_exports_user ON personal_exports (user_id, created_at DESC);
CREATE INDEX idx_personal_exports_expiring ON personal_exports (expires_at) WHERE status = 'ready';

-- Inactivité : dernière activité (connexion ou renouvellement de session), avertissement envoyé
-- avant la suppression (remis à NULL dès que le compte sert de nouveau).
ALTER TABLE users
  ADD COLUMN last_active_at       timestamptz,
  ADD COLUMN inactivity_warned_at timestamptz;
UPDATE users SET last_active_at = COALESCE(last_login_at, created_at);
ALTER TABLE users ALTER COLUMN last_active_at SET NOT NULL, ALTER COLUMN last_active_at SET DEFAULT now();
CREATE INDEX idx_users_inactive ON users (last_active_at) WHERE status = 'active' AND role <> 'admin';

-- Signalements : passé 90 jours, l'auteur est remplacé par un pseudonyme (HMAC, même clé que les
-- exports admin : un même auteur garde le même pseudonyme).
ALTER TABLE reports
  ADD COLUMN reporter_pseudonym text,
  ADD COLUMN pseudonymized_at   timestamptz,
  ADD CONSTRAINT ck_reports_pseudonym CHECK (reporter_pseudonym IS NULL OR reporter_id IS NULL);
CREATE INDEX idx_reports_created ON reports (created_at);

-- Stations : compte du gérant supprimé (point de départ de la conservation du justificatif) ;
-- justificatif supprimé au terme de sa conservation.
ALTER TABLE stations
  ADD COLUMN manager_deleted_at  timestamptz,
  ADD COLUMN document_deleted_at timestamptz;

-- Historique des stocks au-delà de sa conservation : agrégat journalier par station et produit,
-- sans lien avec le gérant.
CREATE TABLE stock_history_daily (
  day           date        NOT NULL,
  station_id    uuid        NOT NULL,
  product_id    smallint    NOT NULL,
  changes       integer     NOT NULL,
  min_quantity  integer     NOT NULL,
  max_quantity  integer     NOT NULL,
  last_quantity integer     NOT NULL,
  last_at       timestamptz NOT NULL,
  CONSTRAINT pk_stock_history_daily PRIMARY KEY (day, station_id, product_id),
  CONSTRAINT fk_stock_history_daily_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE,
  CONSTRAINT fk_stock_history_daily_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);
CREATE INDEX idx_stock_history_created ON stock_history (created_at);

-- +goose Down
DROP INDEX IF EXISTS idx_stock_history_created;
DROP TABLE IF EXISTS stock_history_daily;
ALTER TABLE stations DROP COLUMN IF EXISTS document_deleted_at, DROP COLUMN IF EXISTS manager_deleted_at;
DROP INDEX IF EXISTS idx_reports_created;
ALTER TABLE reports
  DROP CONSTRAINT IF EXISTS ck_reports_pseudonym,
  DROP COLUMN IF EXISTS pseudonymized_at,
  DROP COLUMN IF EXISTS reporter_pseudonym;
DROP INDEX IF EXISTS idx_users_inactive;
ALTER TABLE users DROP COLUMN IF EXISTS inactivity_warned_at, DROP COLUMN IF EXISTS last_active_at;
DROP TABLE IF EXISTS personal_exports;
DROP INDEX IF EXISTS idx_data_requests_created;
DROP INDEX IF EXISTS idx_data_requests_user;
DELETE FROM data_requests WHERE type = 'other';
ALTER TABLE data_requests
  DROP CONSTRAINT IF EXISTS ck_data_requests_closed_at,
  DROP CONSTRAINT IF EXISTS ck_data_requests_rejected_note,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS source,
  ADD COLUMN export_object_key text;
DROP TYPE IF EXISTS personal_export_status;
DROP TYPE IF EXISTS data_request_source;
-- Les valeurs ajoutées aux enums (« other », « data_requests ») se retirent en recréant les types.
DELETE FROM exports WHERE dataset = 'data_requests';
ALTER TYPE export_dataset RENAME TO export_dataset_old;
CREATE TYPE export_dataset AS ENUM ('stations', 'stocks', 'search_stats', 'reports', 'audit');
ALTER TABLE exports ALTER COLUMN dataset TYPE export_dataset USING dataset::text::export_dataset;
DROP TYPE export_dataset_old;
ALTER TYPE data_request_type RENAME TO data_request_type_old;
CREATE TYPE data_request_type AS ENUM ('access', 'export', 'rectification', 'deletion', 'opposition');
ALTER TABLE data_requests ALTER COLUMN type TYPE data_request_type USING type::text::data_request_type;
DROP TYPE data_request_type_old;
