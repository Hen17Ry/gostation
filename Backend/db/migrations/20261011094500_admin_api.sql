-- API admin (étape 7) :
--   * comptes désactivés par l'admin (date et motif ; connexion refusée avec un message dédié) ;
--   * date du dernier changement de statut d'une station (ancienneté des dossiers en attente),
--     tenue par un trigger quel que soit le chemin d'écriture ;
--   * instantanés horaires de la fraîcheur des stocks (séries du tableau de bord) ;
--   * exports admin générés par le worker (fichier chiffré, supprimé 24 h après sa génération) ;
--   * index de lecture du journal d'audit et de la liste des comptes.

-- +goose Up
ALTER TABLE users
  ADD COLUMN disabled_at      timestamptz,
  ADD COLUMN disabled_reason  text,
  ADD CONSTRAINT ck_users_disabled CHECK ((status = 'disabled') = (disabled_at IS NOT NULL)),
  ADD CONSTRAINT ck_users_disabled_reason CHECK (disabled_reason IS NULL OR disabled_at IS NOT NULL);
CREATE INDEX idx_users_created ON users (created_at DESC, id DESC);

ALTER TABLE stations ADD COLUMN status_changed_at timestamptz NOT NULL DEFAULT now();

-- +goose StatementBegin
CREATE FUNCTION set_status_changed_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER trg_stations_status_changed_at BEFORE UPDATE OF status ON stations
  FOR EACH ROW EXECUTE FUNCTION set_status_changed_at();

-- Fraîcheur des stocks des stations approuvées (produits actifs), relevée chaque heure par le
-- worker : frais (< 8 h), stale (8 à 24 h), exclus (> 24 h). Aucune donnée personnelle.
CREATE TABLE stock_freshness_stats (
  bucket      timestamptz NOT NULL,             -- heure tronquée du relevé
  product_id  smallint    NOT NULL,
  fresh       integer     NOT NULL,
  stale       integer     NOT NULL,
  expired     integer     NOT NULL,
  CONSTRAINT pk_stock_freshness_stats PRIMARY KEY (bucket, product_id),
  CONSTRAINT fk_stock_freshness_stats_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT ck_stock_freshness_stats_counts CHECK (fresh >= 0 AND stale >= 0 AND expired >= 0)
);

CREATE TYPE export_dataset AS ENUM ('stations', 'stocks', 'search_stats', 'reports', 'audit');
CREATE TYPE export_format  AS ENUM ('csv', 'json');
CREATE TYPE export_status  AS ENUM ('pending', 'ready', 'failed', 'expired');

CREATE TABLE exports (
  id            uuid           NOT NULL DEFAULT uuidv7(),
  requested_by  uuid,
  dataset       export_dataset NOT NULL,
  format        export_format  NOT NULL,
  params        jsonb          NOT NULL DEFAULT '{}',   -- filtres validés (période, produit, statut)
  status        export_status  NOT NULL DEFAULT 'pending',
  object_key    text,                                   -- fichier chiffré (enveloppe AES-256-GCM)
  wrapped_key   bytea,
  sha256        bytea,                                  -- empreinte du fichier en clair
  size_bytes    bigint,
  row_count     integer,
  error         text,                                   -- code générique, jamais de donnée
  created_at    timestamptz    NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  expires_at    timestamptz,                            -- fichier supprimé à cette date (24 h)
  CONSTRAINT pk_exports PRIMARY KEY (id),
  CONSTRAINT fk_exports_requested_by FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT ck_exports_file CHECK ((status = 'ready') = (object_key IS NOT NULL AND wrapped_key IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE INDEX idx_exports_created ON exports (created_at DESC, id DESC);
CREATE INDEX idx_exports_expiring ON exports (expires_at) WHERE status = 'ready';

-- Journal d'audit : lecture par période (curseur created_at, id) et filtre par action.
CREATE INDEX idx_audit_logs_created ON audit_logs (created_at DESC, id DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs (action, created_at DESC);

-- +goose Down
DROP INDEX IF EXISTS idx_audit_logs_action;
DROP INDEX IF EXISTS idx_audit_logs_created;
DROP TABLE IF EXISTS exports;
DROP TYPE IF EXISTS export_status;
DROP TYPE IF EXISTS export_format;
DROP TYPE IF EXISTS export_dataset;
DROP TABLE IF EXISTS stock_freshness_stats;
DROP TRIGGER IF EXISTS trg_stations_status_changed_at ON stations;
DROP FUNCTION IF EXISTS set_status_changed_at();
ALTER TABLE stations DROP COLUMN IF EXISTS status_changed_at;
DROP INDEX IF EXISTS idx_users_created;
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS ck_users_disabled_reason,
  DROP CONSTRAINT IF EXISTS ck_users_disabled,
  DROP COLUMN IF EXISTS disabled_reason,
  DROP COLUMN IF EXISTS disabled_at;
