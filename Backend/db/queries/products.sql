-- name: ListActiveProducts :many
-- Catalogue visible par les clients, dans l'ordre d'affichage.
SELECT id, code, kind, unit, size_kg, label_fr, sort_order
FROM products
WHERE is_active
ORDER BY sort_order, id;

-- name: ListProductsForAdmin :many
-- Catalogue complet (désactivés compris), avec le nombre de stations qui vendent chaque produit.
-- Curseur (sort_order, id) croissants.
SELECT p.id, p.code, p.kind, p.unit, p.size_kg, p.label_fr, p.is_active, p.sort_order, p.created_at, p.updated_at,
       (SELECT count(*) FROM station_stocks ss WHERE ss.product_id = p.id)::int AS stations
FROM products p
WHERE sqlc.narg(cursor_sort)::smallint IS NULL
   OR (p.sort_order, p.id) > (sqlc.narg(cursor_sort)::smallint, sqlc.narg(cursor_id)::smallint)
ORDER BY p.sort_order, p.id
LIMIT @page_size;

-- name: GetProductForAdmin :one
SELECT p.id, p.code, p.kind, p.unit, p.size_kg, p.label_fr, p.is_active, p.sort_order, p.created_at, p.updated_at,
       (SELECT count(*) FROM station_stocks ss WHERE ss.product_id = p.id)::int AS stations
FROM products p
WHERE p.id = @id;

-- name: CreateProduct :one
-- Ordre d'affichage par défaut : après le dernier produit.
INSERT INTO products (code, kind, unit, size_kg, label_fr, is_active, sort_order)
VALUES (@code, @kind, @unit, sqlc.narg(size_kg), @label_fr, @is_active,
        COALESCE(sqlc.narg(sort_order)::smallint, (SELECT COALESCE(max(sort_order), 0) + 10 FROM products)::smallint))
RETURNING id;

-- name: UpdateProduct :execrows
-- Seuls le libellé, l'ordre et l'activation changent : type, unité, taille et code sont figés.
UPDATE products
SET label_fr   = COALESCE(sqlc.narg(label_fr), label_fr),
    sort_order = COALESCE(sqlc.narg(sort_order)::smallint, sort_order),
    is_active  = COALESCE(sqlc.narg(is_active)::boolean, is_active)
WHERE id = @id;
