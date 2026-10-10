-- Catalogue configurable par l'admin (tailles de gaz). Jamais supprimé : désactivé.

-- +goose Up
CREATE TABLE products (
  id          smallint GENERATED ALWAYS AS IDENTITY,
  code        text         NOT NULL,
  kind        product_kind NOT NULL,
  unit        product_unit NOT NULL,
  size_kg     numeric(5,2),
  label_fr    text         NOT NULL,
  is_active   boolean      NOT NULL DEFAULT true,
  sort_order  smallint     NOT NULL DEFAULT 0,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pk_products PRIMARY KEY (id),
  CONSTRAINT uq_products_code UNIQUE (code),
  CONSTRAINT uq_products_kind_size UNIQUE NULLS NOT DISTINCT (kind, size_kg),
  -- « size_kg IS NOT NULL » est indispensable : un CHECK évalué à NULL est considéré comme satisfait.
  CONSTRAINT ck_products_kind_unit CHECK (
    (kind = 'lpg' AND unit = 'cylinder' AND size_kg IS NOT NULL AND size_kg > 0)
    OR (kind IN ('petrol', 'diesel') AND unit = 'liter' AND size_kg IS NULL))
);

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS products;
