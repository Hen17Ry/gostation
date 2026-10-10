-- Favoris (compte requis, décision D3). Supprimés avec le compte ou la station.

-- +goose Up
CREATE TABLE favorites (
  user_id     uuid        NOT NULL,
  station_id  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_favorites PRIMARY KEY (user_id, station_id),
  CONSTRAINT fk_favorites_user    FOREIGN KEY (user_id)    REFERENCES users (id)    ON DELETE CASCADE,
  CONSTRAINT fk_favorites_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE
);

CREATE INDEX idx_favorites_station ON favorites (station_id);

-- +goose Down
DROP TABLE IF EXISTS favorites;
