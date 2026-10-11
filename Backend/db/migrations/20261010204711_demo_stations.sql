-- Stations fictives de développement (make seed-dev, bench) : marquées pour être repérables et
-- supprimables. La commande de seed refuse de tourner hors APP_ENV=development.

-- +goose Up
ALTER TABLE stations ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
CREATE INDEX idx_stations_demo ON stations (id) WHERE is_demo;

-- +goose Down
DROP INDEX IF EXISTS idx_stations_demo;
ALTER TABLE stations DROP COLUMN IF EXISTS is_demo;
