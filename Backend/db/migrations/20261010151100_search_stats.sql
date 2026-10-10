-- Stats de recherche anonymes, seule trace des recherches : cellule H3 res 7 et heure, jamais la position.

-- +goose Up
CREATE TABLE search_stats (
  bucket            timestamptz NOT NULL,
  h3_r7             bigint      NOT NULL,
  product_id        smallint    NOT NULL,
  searches          integer     NOT NULL DEFAULT 0,
  empty_within_5km  integer     NOT NULL DEFAULT 0,
  CONSTRAINT pk_search_stats PRIMARY KEY (bucket, h3_r7, product_id),
  CONSTRAINT fk_search_stats_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT ck_search_stats_counts CHECK (searches >= 0 AND empty_within_5km >= 0)
);

-- +goose Down
DROP TABLE IF EXISTS search_stats;
