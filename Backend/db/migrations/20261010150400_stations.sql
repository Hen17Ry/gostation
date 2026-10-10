-- Stations (V1 : un gérant = une station) et leurs horaires d'ouverture.

-- +goose Up
CREATE TABLE stations (
  id                    uuid           NOT NULL DEFAULT uuidv7(),
  manager_id            uuid,
  status                station_status NOT NULL DEFAULT 'pending',
  name                  text           NOT NULL,
  brand                 text,
  ifu                   char(13)       NOT NULL,
  rccm                  text           NOT NULL,
  address               text           NOT NULL,
  city                  text,
  phone                 text           NOT NULL,
  location              geography(Point, 4326),
  -- Coordonnées dérivées : l'application lit lat/lng et ne manipule jamais le type geography.
  lat                   double precision GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED,
  lng                   double precision GENERATED ALWAYS AS (ST_X(location::geometry)) STORED,
  location_set_at       timestamptz,
  h3_r8                 bigint,
  document_object_key   text,
  document_wrapped_key  bytea,
  document_sha256       bytea,
  document_mime         text,
  status_reason         text,
  reviewed_by           uuid,
  reviewed_at           timestamptz,
  last_stock_update_at  timestamptz,
  last_reminder_at      timestamptz,
  created_at            timestamptz    NOT NULL DEFAULT now(),
  updated_at            timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT pk_stations PRIMARY KEY (id),
  CONSTRAINT fk_stations_manager  FOREIGN KEY (manager_id)  REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_stations_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT uq_stations_manager UNIQUE (manager_id),
  CONSTRAINT ck_stations_ifu CHECK (ifu ~ '^[0-9]{13}$'),
  CONSTRAINT ck_stations_document_mime
    CHECK (document_mime IN ('application/pdf', 'image/jpeg', 'image/png'))
);

-- Index spatial partiel : ne couvre que ce que la recherche peut renvoyer.
CREATE INDEX idx_stations_location_approved ON stations USING gist (location)
  WHERE status = 'approved' AND location IS NOT NULL;
CREATE INDEX idx_stations_status ON stations (status, created_at DESC);
-- Non unique : un même IFU peut couvrir un réseau de stations (ARCHITECTURE §9).
CREATE INDEX idx_stations_ifu ON stations (ifu);
-- Données périmées (admin) et rappels.
CREATE INDEX idx_stations_last_stock_update ON stations (last_stock_update_at)
  WHERE status = 'approved';

CREATE TRIGGER trg_stations_updated_at
  BEFORE UPDATE ON stations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ISO 8601 : 1 = lundi. 24 h/24 : 00:00 → 24:00. closes_at <= opens_at : la plage passe minuit.
CREATE TABLE station_opening_hours (
  station_id  uuid     NOT NULL,
  weekday     smallint NOT NULL,
  opens_at    time     NOT NULL,
  closes_at   time     NOT NULL,
  CONSTRAINT pk_station_opening_hours PRIMARY KEY (station_id, weekday, opens_at),
  CONSTRAINT fk_station_opening_hours_station
    FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE,
  CONSTRAINT ck_station_opening_hours_weekday CHECK (weekday BETWEEN 1 AND 7)
);

-- +goose Down
DROP TABLE IF EXISTS station_opening_hours;
DROP TABLE IF EXISTS stations;
