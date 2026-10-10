-- Stock courant (bouteilles pour le gaz, litres pour les carburants) et son historique.
-- L'historique est écrit dans la même transaction que le stock, par l'application (pas de trigger).

-- +goose Up
CREATE TABLE station_stocks (
  station_id  uuid        NOT NULL,
  product_id  smallint    NOT NULL,
  quantity    integer     NOT NULL,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_station_stocks PRIMARY KEY (station_id, product_id),
  CONSTRAINT fk_station_stocks_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE,
  CONSTRAINT fk_station_stocks_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_station_stocks_updater FOREIGN KEY (updated_by) REFERENCES users (id)    ON DELETE SET NULL,
  CONSTRAINT ck_station_stocks_quantity CHECK (quantity >= 0)
);

CREATE INDEX idx_station_stocks_available ON station_stocks (product_id, station_id)
  WHERE quantity > 0;
-- Fraîcheur : stale (> 8 h) et expiré (> 24 h).
CREATE INDEX idx_station_stocks_updated_at ON station_stocks (updated_at);

CREATE TRIGGER trg_station_stocks_updated_at
  BEFORE UPDATE ON station_stocks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stock_history (
  id                 bigint GENERATED ALWAYS AS IDENTITY,
  station_id         uuid         NOT NULL,
  product_id         smallint     NOT NULL,
  quantity           integer      NOT NULL,
  previous_quantity  integer,
  source             stock_source NOT NULL,
  changed_by         uuid,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pk_stock_history PRIMARY KEY (id),
  CONSTRAINT fk_stock_history_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE,
  CONSTRAINT fk_stock_history_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_history_changer FOREIGN KEY (changed_by) REFERENCES users (id)    ON DELETE SET NULL,
  CONSTRAINT ck_stock_history_quantity CHECK (quantity >= 0),
  CONSTRAINT ck_stock_history_previous CHECK (previous_quantity >= 0)
);

CREATE INDEX idx_stock_history_station ON stock_history (station_id, product_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS stock_history;
DROP TABLE IF EXISTS station_stocks;
