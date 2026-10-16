-- Favoris et alertes « de retour en stock » (étape 6).

-- name: ListFavorites :many
SELECT f.station_id, f.created_at, s.name, s.brand, s.address, s.city, s.lat, s.lng,
       (s.status = 'approved')::boolean AS available,
       COALESCE((SELECT array_agg(a.product_id ORDER BY a.product_id) FROM favorite_alerts a
                 WHERE a.user_id = f.user_id AND a.station_id = f.station_id), '{}')::smallint[] AS alert_product_ids
FROM favorites f
JOIN stations s ON s.id = f.station_id
WHERE f.user_id = @user_id
ORDER BY f.created_at DESC, f.station_id;

-- name: CountFavorites :one
SELECT count(*) FROM favorites WHERE user_id = @user_id;

-- name: InsertFavorite :execrows
INSERT INTO favorites (user_id, station_id) VALUES (@user_id, @station_id) ON CONFLICT DO NOTHING;

-- name: DeleteFavorite :execrows
DELETE FROM favorites WHERE user_id = @user_id AND station_id = @station_id;

-- name: DeleteFavoriteAlerts :exec
DELETE FROM favorite_alerts WHERE user_id = @user_id AND station_id = @station_id;

-- name: InsertFavoriteAlerts :exec
INSERT INTO favorite_alerts (user_id, station_id, product_id)
SELECT @user_id::uuid, @station_id::uuid, unnest(@product_ids::smallint[])
ON CONFLICT DO NOTHING;

-- name: ListBackInStockSubscribers :many
-- Abonnés actifs et vérifiés, sans opt-out du type back_in_stock.
SELECT a.user_id
FROM favorite_alerts a
JOIN users u ON u.id = a.user_id
WHERE a.station_id = @station_id AND a.product_id = @product_id
  AND u.status = 'active' AND u.email_verified_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM notification_opt_outs o WHERE o.user_id = a.user_id AND o.type = 'back_in_stock')
ORDER BY a.user_id;

-- name: GetBackInStockContext :one
-- Station et produit d'une alerte, avec le stock courant (0 si le produit n'est plus vendu).
SELECT s.name AS station_name, (s.status = 'approved')::boolean AS approved, p.label_fr AS product_label,
       COALESCE(ss.quantity, 0)::int AS quantity
FROM stations s
JOIN products p ON p.id = @product_id::smallint
LEFT JOIN station_stocks ss ON ss.station_id = s.id AND ss.product_id = p.id
WHERE s.id = @station_id::uuid;

-- name: HasPendingBackInStock :one
SELECT EXISTS (
  SELECT 1 FROM back_in_stock_alerts
  WHERE user_id = @user_id AND station_id = @station_id AND product_id = @product_id AND status = 'pending'
)::boolean;

-- name: CountBackInStockSentSince :one
-- Alertes envoyées pour un couple (station, produit) depuis since (limite des 6 h).
SELECT count(*) FROM back_in_stock_alerts
WHERE user_id = @user_id AND station_id = @station_id AND product_id = @product_id
  AND status = 'sent' AND sent_at > @since::timestamptz;

-- name: CountUserBackInStockSentSince :one
-- Alertes envoyées à l'utilisateur depuis since (limite de 5 par jour).
SELECT count(*) FROM back_in_stock_alerts
WHERE user_id = @user_id AND status = 'sent' AND sent_at >= @since::timestamptz;

-- name: InsertBackInStockAlert :exec
INSERT INTO back_in_stock_alerts (user_id, station_id, product_id, status, created_at, sent_at)
VALUES (@user_id, @station_id, @product_id, @status, @created_at, sqlc.narg(sent_at));

-- name: ListPendingBackInStock :many
SELECT id, user_id, station_id, product_id
FROM back_in_stock_alerts
WHERE status = 'pending'
ORDER BY created_at, id;

-- name: SetBackInStockStatus :exec
UPDATE back_in_stock_alerts SET status = @status, sent_at = sqlc.narg(sent_at) WHERE id = @id AND status = 'pending';

-- name: DeleteUserBackInStockAlerts :exec
DELETE FROM back_in_stock_alerts WHERE user_id = @user_id;
