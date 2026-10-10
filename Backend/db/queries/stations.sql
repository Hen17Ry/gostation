-- name: GetStationByID :one
-- lat/lng sont les colonnes générées depuis location (NULL tant que la station n'est pas
-- épinglée) : le type geography et les champs du justificatif ne sortent jamais de la base.
SELECT id, manager_id, status, name, brand, ifu, rccm, address, city, phone,
       lat, lng, location_set_at, h3_r8, status_reason, reviewed_by, reviewed_at,
       last_stock_update_at, created_at, updated_at
FROM stations
WHERE id = @id;
