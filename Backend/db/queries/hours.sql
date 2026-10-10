-- name: ListOpeningHours :many
SELECT weekday, opens_at, closes_at
FROM station_opening_hours
WHERE station_id = @station_id
ORDER BY weekday, opens_at;

-- name: DeleteOpeningHours :exec
DELETE FROM station_opening_hours WHERE station_id = @station_id;

-- name: InsertOpeningHours :copyfrom
INSERT INTO station_opening_hours (station_id, weekday, opens_at, closes_at)
VALUES (@station_id, @weekday, @opens_at, @closes_at);

-- name: ListClosures :many
-- Fermetures à partir d'une date (le jour même compris).
SELECT id, closed_on, reason, created_at
FROM station_closures
WHERE station_id = @station_id AND closed_on >= @from_date
ORDER BY closed_on;

-- name: CreateClosure :one
INSERT INTO station_closures (station_id, closed_on, reason, created_by)
VALUES (@station_id, @closed_on, sqlc.narg(reason), @created_by)
RETURNING id, closed_on, reason, created_at;

-- name: DeleteClosure :execrows
DELETE FROM station_closures WHERE id = @id AND station_id = @station_id;
