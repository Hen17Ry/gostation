-- Signalements (étape 6) :
--   * motif « stock épuisé » (par produit) : stock_incorrect devient out_of_stock ;
--   * commentaire de 300 caractères au plus, obligatoire pour « autre » ;
--   * classement en abusif par l'admin, retrait du droit de signaler ;
--   * effets des seuils (3 : badge « signalé », 5 : exclusion de la recherche) mémorisés dans
--     station_report_flags jusqu'à la prochaine mise à jour ou confirmation du gérant ;
--   * alertes admin (gérant inactif, seuil de 5 signalements).
-- La position de l'auteur sert au contrôle des 2 km et n'est jamais stockée.

-- +goose Up
ALTER TYPE report_reason RENAME VALUE 'stock_incorrect' TO 'out_of_stock';

ALTER TABLE reports
  DROP CONSTRAINT ck_reports_comment,
  ADD COLUMN abusive boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT ck_reports_comment CHECK (char_length(comment) <= 300),
  ADD CONSTRAINT ck_reports_comment_other CHECK (reason <> 'other' OR comment IS NOT NULL),
  ADD CONSTRAINT ck_reports_product CHECK ((reason = 'out_of_stock') = (product_id IS NOT NULL)),
  ADD CONSTRAINT ck_reports_abusive CHECK (NOT abusive OR status = 'dismissed');

-- Limites par auteur (1 par station et par motif toutes les 2 h, 10 par jour) et comptage des
-- auteurs distincts par station et par motif.
CREATE INDEX idx_reports_reporter ON reports (reporter_id, created_at DESC);
CREATE INDEX idx_reports_station_open ON reports (station_id, reason, product_id, created_at DESC)
  WHERE status = 'open';

ALTER TABLE users
  ADD COLUMN reporting_banned_at   timestamptz,
  ADD COLUMN reporting_ban_reason  text,
  ADD CONSTRAINT ck_users_reporting_ban CHECK (reporting_ban_reason IS NULL OR reporting_banned_at IS NOT NULL);

-- Effet d'un signalement collectif. product_id NULL = toute la station (fermée, position, autre).
CREATE TABLE station_report_flags (
  id           uuid          NOT NULL DEFAULT uuidv7(),
  station_id   uuid          NOT NULL,
  reason       report_reason NOT NULL,
  product_id   smallint,
  reporters    smallint      NOT NULL,                 -- auteurs distincts au déclenchement
  flagged_at   timestamptz   NOT NULL DEFAULT now(),   -- seuil 3 : badge « signalé »
  excluded_at  timestamptz,                            -- seuil 5 : exclu de la recherche
  CONSTRAINT pk_station_report_flags PRIMARY KEY (id),
  CONSTRAINT fk_station_report_flags_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE,
  CONSTRAINT fk_station_report_flags_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT uq_station_report_flags UNIQUE NULLS NOT DISTINCT (station_id, reason, product_id),
  CONSTRAINT ck_station_report_flags_product CHECK ((reason = 'out_of_stock') = (product_id IS NOT NULL))
);

CREATE INDEX idx_station_report_flags_excluded ON station_report_flags (product_id, station_id)
  WHERE excluded_at IS NOT NULL;

CREATE TYPE admin_alert_kind AS ENUM ('manager_inactive', 'reports_threshold');

CREATE TABLE admin_alerts (
  id           uuid             NOT NULL DEFAULT uuidv7(),
  kind         admin_alert_kind NOT NULL,
  station_id   uuid             NOT NULL,
  reason       report_reason,                          -- reports_threshold
  product_id   smallint,
  details      jsonb            NOT NULL DEFAULT '{}',
  created_at   timestamptz      NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid,                                   -- NULL + resolved_at : résolue automatiquement
  resolution   text,
  CONSTRAINT pk_admin_alerts PRIMARY KEY (id),
  CONSTRAINT fk_admin_alerts_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_alerts_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_alerts_resolver FOREIGN KEY (resolved_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT ck_admin_alerts_resolution CHECK (char_length(resolution) <= 500),
  CONSTRAINT ck_admin_alerts_resolved CHECK (resolved_by IS NULL OR resolved_at IS NOT NULL)
);

-- Une seule alerte ouverte par cause.
CREATE UNIQUE INDEX uq_admin_alerts_open ON admin_alerts (kind, station_id, reason, product_id)
  NULLS NOT DISTINCT WHERE resolved_at IS NULL;
CREATE INDEX idx_admin_alerts_created ON admin_alerts (created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS admin_alerts;
DROP TYPE IF EXISTS admin_alert_kind;
DROP TABLE IF EXISTS station_report_flags;
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS ck_users_reporting_ban,
  DROP COLUMN IF EXISTS reporting_ban_reason,
  DROP COLUMN IF EXISTS reporting_banned_at;
DROP INDEX IF EXISTS idx_reports_station_open;
DROP INDEX IF EXISTS idx_reports_reporter;
DELETE FROM reports WHERE status = 'dismissed' AND abusive;
ALTER TABLE reports
  DROP CONSTRAINT IF EXISTS ck_reports_abusive,
  DROP CONSTRAINT IF EXISTS ck_reports_product,
  DROP CONSTRAINT IF EXISTS ck_reports_comment_other,
  DROP CONSTRAINT IF EXISTS ck_reports_comment,
  DROP COLUMN IF EXISTS abusive,
  ADD CONSTRAINT ck_reports_comment CHECK (char_length(comment) <= 500);
ALTER TYPE report_reason RENAME VALUE 'out_of_stock' TO 'stock_incorrect';
