-- Agrégats des stats de recherche (étape 7), alimentés par la tâche stats:flush du worker dans la
-- même transaction que search_stats (upsert additif) : toujours cohérents, sans rafraîchissement.
-- Une vue matérialisée aurait recalculé tout l'historique à chaque rafraîchissement.
--   * search_stats_daily : par jour local (Africa/Porto-Novo), cellule et produit — carte des
--     pénuries et top des zones sur 7 jours, 30 jours ou une plage de dates, export ;
--   * search_stats_totals : par heure et produit, tous lieux confondus — totaux, évolutions,
--     séries et répartition par heure de la journée.
-- Comme search_stats, aucune position ni identifiant : des compteurs par cellule H3 res 7.

-- +goose Up
CREATE TABLE search_stats_daily (
  day               date     NOT NULL,
  h3_r7             bigint   NOT NULL,
  product_id        smallint NOT NULL,
  searches          integer  NOT NULL DEFAULT 0,
  empty_within_5km  integer  NOT NULL DEFAULT 0,
  CONSTRAINT pk_search_stats_daily PRIMARY KEY (day, h3_r7, product_id),
  CONSTRAINT fk_search_stats_daily_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT ck_search_stats_daily_counts CHECK (searches >= 0 AND empty_within_5km >= 0)
);

CREATE TABLE search_stats_totals (
  bucket            timestamptz NOT NULL,
  product_id        smallint    NOT NULL,
  searches          integer     NOT NULL DEFAULT 0,
  empty_within_5km  integer     NOT NULL DEFAULT 0,
  CONSTRAINT pk_search_stats_totals PRIMARY KEY (bucket, product_id),
  CONSTRAINT fk_search_stats_totals_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT ck_search_stats_totals_counts CHECK (searches >= 0 AND empty_within_5km >= 0)
);

-- +goose Down
DROP TABLE IF EXISTS search_stats_totals;
DROP TABLE IF EXISTS search_stats_daily;
