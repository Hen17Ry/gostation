-- Gestion des stations par le gérant et validation admin (étape 4) :
--   * stations.version : verrouillage optimiste (ETag / If-Match) ;
--   * signalement d'une épingle éloignée de l'appareil du gérant (> 500 m) ;
--   * station_stocks.last_confirmed_at : « rien n'a changé », distinct de updated_at ;
--   * fermetures exceptionnelles, demandes de déplacement, frontières de pays.

-- +goose Up
ALTER TABLE stations
  ADD COLUMN version                   integer NOT NULL DEFAULT 1,
  ADD COLUMN location_flagged_at       timestamptz,
  ADD COLUMN location_flag_distance_m  integer,
  ADD COLUMN location_flag_accuracy_m  integer,
  ADD CONSTRAINT ck_stations_version CHECK (version > 0),
  ADD CONSTRAINT ck_stations_location_flag
    CHECK ((location_flagged_at IS NULL) = (location_flag_distance_m IS NULL));

-- Stocks : updated_at ne bouge que si la quantité change ; last_confirmed_at enregistre la
-- confirmation « rien n'a changé ». La fraîcheur vaut le plus récent des deux.
ALTER TABLE station_stocks
  ADD COLUMN last_confirmed_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER trg_station_stocks_updated_at ON station_stocks;

-- +goose StatementBegin
CREATE FUNCTION set_stock_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
      NEW.updated_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER trg_station_stocks_updated_at
  BEFORE UPDATE ON station_stocks
  FOR EACH ROW EXECUTE FUNCTION set_stock_updated_at();

DROP INDEX idx_station_stocks_updated_at;
CREATE INDEX idx_station_stocks_freshness ON station_stocks (GREATEST(updated_at, last_confirmed_at));

-- Fermetures exceptionnelles (jours fériés compris) : journée civile entière, heure du Bénin.
CREATE TABLE station_closures (
  id          uuid        NOT NULL DEFAULT uuidv7(),
  station_id  uuid        NOT NULL,
  closed_on   date        NOT NULL,
  reason      text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_station_closures PRIMARY KEY (id),
  CONSTRAINT fk_station_closures_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE,
  CONSTRAINT fk_station_closures_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT uq_station_closures_day UNIQUE (station_id, closed_on),
  CONSTRAINT ck_station_closures_reason CHECK (char_length(reason) <= 200)
);

-- Demandes de déplacement (> 200 m) : l'ancienne position reste active jusqu'à validation.
CREATE TYPE location_request_status AS ENUM ('pending', 'approved', 'rejected', 'superseded');

CREATE TABLE station_location_requests (
  id                 uuid                    NOT NULL DEFAULT uuidv7(),
  station_id         uuid                    NOT NULL,
  requested_by       uuid,
  location           geography(Point, 4326)  NOT NULL,
  lat                double precision GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED,
  lng                double precision GENERATED ALWAYS AS (ST_X(location::geometry)) STORED,
  h3_r8              bigint                  NOT NULL,
  distance_m         integer                 NOT NULL,
  device_distance_m  integer,
  device_accuracy_m  integer,
  status             location_request_status NOT NULL DEFAULT 'pending',
  review_reason      text,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  created_at         timestamptz             NOT NULL DEFAULT now(),
  CONSTRAINT pk_station_location_requests PRIMARY KEY (id),
  CONSTRAINT fk_station_location_requests_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE,
  CONSTRAINT fk_station_location_requests_requester FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_station_location_requests_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT ck_station_location_requests_distance CHECK (distance_m >= 0)
);

-- Une seule demande en attente par station (une nouvelle demande remplace la précédente).
CREATE UNIQUE INDEX uq_station_location_requests_pending ON station_location_requests (station_id)
  WHERE status = 'pending';

-- Frontières de pays (contrôle des épingles). boundary_buffered = frontière élargie de 2 km.
CREATE TABLE country_boundaries (
  code               char(3)                       NOT NULL,
  name               text                          NOT NULL,
  boundary           geography(MultiPolygon, 4326) NOT NULL,
  boundary_buffered  geography                     NOT NULL,
  source             text                          NOT NULL,
  CONSTRAINT pk_country_boundaries PRIMARY KEY (code)
);

-- +goose Down
DROP TABLE IF EXISTS country_boundaries;
DROP TABLE IF EXISTS station_location_requests;
DROP TYPE IF EXISTS location_request_status;
DROP TABLE IF EXISTS station_closures;

DROP INDEX IF EXISTS idx_station_stocks_freshness;
CREATE INDEX idx_station_stocks_updated_at ON station_stocks (updated_at);
DROP TRIGGER IF EXISTS trg_station_stocks_updated_at ON station_stocks;
DROP FUNCTION IF EXISTS set_stock_updated_at();
CREATE TRIGGER trg_station_stocks_updated_at
  BEFORE UPDATE ON station_stocks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE station_stocks DROP COLUMN IF EXISTS last_confirmed_at;

ALTER TABLE stations
  DROP CONSTRAINT IF EXISTS ck_stations_location_flag,
  DROP CONSTRAINT IF EXISTS ck_stations_version,
  DROP COLUMN IF EXISTS location_flag_accuracy_m,
  DROP COLUMN IF EXISTS location_flag_distance_m,
  DROP COLUMN IF EXISTS location_flagged_at,
  DROP COLUMN IF EXISTS version;
