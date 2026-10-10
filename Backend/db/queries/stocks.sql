-- name: ListStationProducts :many
-- Catalogue actif, avec ce que la station vend (ligne présente) et son stock.
SELECT p.id, p.code, p.kind, p.unit, p.size_kg, p.label_fr, p.sort_order,
       (ss.station_id IS NOT NULL)::boolean AS sold,
       ss.quantity, ss.updated_at, ss.last_confirmed_at
FROM products p
LEFT JOIN station_stocks ss ON ss.product_id = p.id AND ss.station_id = @station_id
WHERE p.is_active
ORDER BY p.sort_order, p.id;

-- name: AddStationProduct :exec
-- Nouveau produit vendu : stock initial 0 (rupture jusqu'à la première saisie).
INSERT INTO station_stocks (station_id, product_id, quantity, updated_by)
VALUES (@station_id, @product_id, 0, @updated_by)
ON CONFLICT (station_id, product_id) DO NOTHING;

-- name: RemoveStationProductsNotIn :many
-- Produits qui ne sont plus vendus (l'historique reste dans stock_history).
DELETE FROM station_stocks
WHERE station_id = @station_id AND NOT (product_id = ANY(@product_ids::smallint[]))
RETURNING product_id;

-- name: ListStationStocksForUpdate :many
-- Stocks vendus, verrouillés pour la mise à jour groupée.
SELECT ss.product_id, ss.quantity, p.unit, p.code
FROM station_stocks ss
JOIN products p ON p.id = ss.product_id
WHERE ss.station_id = @station_id
ORDER BY ss.product_id
FOR UPDATE OF ss;

-- name: SetStockQuantity :exec
-- Une saisie vaut aussi confirmation : last_confirmed_at avance même si la quantité ne change pas.
UPDATE station_stocks
SET quantity = @quantity, updated_by = @updated_by, last_confirmed_at = now()
WHERE station_id = @station_id AND product_id = @product_id;

-- name: ConfirmStationStocks :execrows
-- « Rien n'a changé » : remet le délai de fraîcheur à zéro sans toucher aux quantités.
UPDATE station_stocks
SET last_confirmed_at = now(), updated_by = @updated_by
WHERE station_id = @station_id;

-- name: InsertStockHistory :copyfrom
INSERT INTO stock_history (station_id, product_id, quantity, previous_quantity, source, changed_by)
VALUES (@station_id, @product_id, @quantity, @previous_quantity, @source, @changed_by);

-- name: ListStockHistory :many
SELECT product_id, quantity, previous_quantity, source, changed_by, created_at
FROM stock_history
WHERE station_id = @station_id
ORDER BY id DESC
LIMIT @page_size;
