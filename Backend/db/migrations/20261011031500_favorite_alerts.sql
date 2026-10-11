-- Favoris (étape 6) : alerte « de retour en stock » facultative par produit d'un favori, et
-- journal des alertes (limites : 1 par station et par produit toutes les 6 h, 5 par jour et par
-- utilisateur ; entre 21 h et 7 h, l'alerte attend 7 h en « pending »).

-- +goose Up
CREATE TABLE favorite_alerts (
  user_id     uuid        NOT NULL,
  station_id  uuid        NOT NULL,
  product_id  smallint    NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_favorite_alerts PRIMARY KEY (user_id, station_id, product_id),
  CONSTRAINT fk_favorite_alerts_favorite FOREIGN KEY (user_id, station_id)
    REFERENCES favorites (user_id, station_id) ON DELETE CASCADE,
  CONSTRAINT fk_favorite_alerts_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);

-- Déclenchement : abonnés d'un couple (station, produit).
CREATE INDEX idx_favorite_alerts_station ON favorite_alerts (station_id, product_id);

CREATE TYPE back_in_stock_status AS ENUM ('pending', 'sent', 'dropped');

CREATE TABLE back_in_stock_alerts (
  id          uuid                 NOT NULL DEFAULT uuidv7(),
  user_id     uuid                 NOT NULL,
  station_id  uuid                 NOT NULL,
  product_id  smallint             NOT NULL,
  status      back_in_stock_status NOT NULL,
  created_at  timestamptz          NOT NULL,           -- horloge du service (tests des heures calmes)
  sent_at     timestamptz,
  CONSTRAINT pk_back_in_stock_alerts PRIMARY KEY (id),
  CONSTRAINT fk_back_in_stock_alerts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_back_in_stock_alerts_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE,
  CONSTRAINT fk_back_in_stock_alerts_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT ck_back_in_stock_alerts_sent CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

-- Une seule alerte en attente par (utilisateur, station, produit).
CREATE UNIQUE INDEX uq_back_in_stock_alerts_pending ON back_in_stock_alerts (user_id, station_id, product_id)
  WHERE status = 'pending';
CREATE INDEX idx_back_in_stock_alerts_sent ON back_in_stock_alerts (user_id, sent_at DESC)
  WHERE status = 'sent';
CREATE INDEX idx_back_in_stock_alerts_created ON back_in_stock_alerts (created_at);

-- +goose Down
DROP TABLE IF EXISTS back_in_stock_alerts;
DROP TYPE IF EXISTS back_in_stock_status;
DROP TABLE IF EXISTS favorite_alerts;
