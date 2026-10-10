-- Types énumérés (ARCHITECTURE §3.1).

-- +goose Up
CREATE TYPE user_role           AS ENUM ('user', 'manager', 'admin');
CREATE TYPE user_status         AS ENUM ('active', 'disabled', 'pending_deletion');
CREATE TYPE station_status      AS ENUM ('pending', 'approved', 'rejected', 'suspended');
CREATE TYPE product_kind        AS ENUM ('lpg', 'petrol', 'diesel');
CREATE TYPE product_unit        AS ENUM ('cylinder', 'liter');
CREATE TYPE stock_source        AS ENUM ('manager', 'admin', 'system');
CREATE TYPE report_reason       AS ENUM ('stock_incorrect', 'station_closed', 'wrong_location', 'other');
CREATE TYPE report_status       AS ENUM ('open', 'resolved', 'dismissed');
CREATE TYPE data_request_type   AS ENUM ('access', 'export', 'rectification', 'deletion', 'opposition');
CREATE TYPE data_request_status AS ENUM ('pending', 'in_progress', 'completed', 'rejected');
CREATE TYPE device_platform     AS ENUM ('ios', 'android');

-- +goose Down
DROP TYPE IF EXISTS device_platform;
DROP TYPE IF EXISTS data_request_status;
DROP TYPE IF EXISTS data_request_type;
DROP TYPE IF EXISTS report_status;
DROP TYPE IF EXISTS report_reason;
DROP TYPE IF EXISTS stock_source;
DROP TYPE IF EXISTS product_unit;
DROP TYPE IF EXISTS product_kind;
DROP TYPE IF EXISTS station_status;
DROP TYPE IF EXISTS user_status;
DROP TYPE IF EXISTS user_role;
