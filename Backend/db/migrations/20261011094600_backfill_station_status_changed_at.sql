-- Migration de données : date du dernier changement de statut des stations existantes, au mieux
-- (date de la dernière décision admin, sinon date de création). updated_at n'est pas touché.

-- +goose Up
ALTER TABLE stations DISABLE TRIGGER trg_stations_updated_at;
UPDATE stations SET status_changed_at = COALESCE(reviewed_at, created_at);
ALTER TABLE stations ENABLE TRIGGER trg_stations_updated_at;

-- +goose Down
SELECT 1; -- rien à défaire : la colonne disparaît avec la migration précédente
