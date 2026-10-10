-- name: ListActiveProducts :many
-- Catalogue visible par les clients, dans l'ordre d'affichage.
SELECT id, code, kind, unit, size_kg, label_fr, sort_order
FROM products
WHERE is_active
ORDER BY sort_order, id;
