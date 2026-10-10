-- Migration de données : catalogue initial. Les produits restent ensuite modifiables par l'admin.

-- +goose Up
INSERT INTO products (code, kind, unit, size_kg, label_fr, sort_order) VALUES
  ('lpg_5kg',  'lpg',    'cylinder', 5,    'Gaz 5 kg',  10),
  ('lpg_10kg', 'lpg',    'cylinder', 10,   'Gaz 10 kg', 20),
  ('lpg_25kg', 'lpg',    'cylinder', 25,   'Gaz 25 kg', 30),
  ('petrol',   'petrol', 'liter',    NULL, 'Essence',   40),
  ('diesel',   'diesel', 'liter',    NULL, 'Gasoil',    50);

-- +goose Down
-- Échoue volontairement (FK RESTRICT) si des stocks ou historiques référencent ces produits.
DELETE FROM products WHERE code IN ('lpg_5kg', 'lpg_10kg', 'lpg_25kg', 'petrol', 'diesel');
