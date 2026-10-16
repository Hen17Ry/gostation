-- +goose Up
-- Étape 9C : les décisions de l'admin sur la station (validation, refus, suspension,
-- réactivation, déplacement validé ou refusé) arrivent aussi en push et dans la boîte de
-- réception du gérant, en plus de l'email. Type non désactivable (absent des préférences).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'station_decision';

-- +goose Down
-- Une valeur d'enum ne se retire pas : on recrée le type sans elle, après avoir supprimé les
-- notifications de ce type (aucun opt-out ne peut exister pour lui).
DELETE FROM notifications WHERE type = 'station_decision';
DELETE FROM notification_opt_outs WHERE type = 'station_decision';
ALTER TYPE notification_type RENAME TO notification_type_old;
CREATE TYPE notification_type AS ENUM ('stock_reminder', 'station_reported', 'back_in_stock');
ALTER TABLE notifications ALTER COLUMN type TYPE notification_type USING type::text::notification_type;
ALTER TABLE notification_opt_outs ALTER COLUMN type TYPE notification_type USING type::text::notification_type;
DROP TYPE notification_type_old;
