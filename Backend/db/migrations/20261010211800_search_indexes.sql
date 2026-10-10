-- Recherche : les fermetures du jour sont lues une fois par requête (closed_on = date locale).

-- +goose Up
CREATE INDEX idx_station_closures_day ON station_closures (closed_on, station_id);

-- +goose Down
DROP INDEX IF EXISTS idx_station_closures_day;
