-- Signalements des utilisateurs (compte requis).

-- +goose Up
CREATE TABLE reports (
  id               uuid          NOT NULL DEFAULT uuidv7(),
  station_id       uuid          NOT NULL,
  product_id       smallint,
  reporter_id      uuid,
  reason           report_reason NOT NULL,
  comment          text,
  status           report_status NOT NULL DEFAULT 'open',
  resolved_by      uuid,
  resolution_note  text,
  resolved_at      timestamptz,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_reports PRIMARY KEY (id),
  CONSTRAINT fk_reports_station  FOREIGN KEY (station_id)  REFERENCES stations (id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_product  FOREIGN KEY (product_id)  REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id)    ON DELETE SET NULL,
  CONSTRAINT fk_reports_resolver FOREIGN KEY (resolved_by) REFERENCES users (id)    ON DELETE SET NULL,
  CONSTRAINT ck_reports_comment CHECK (char_length(comment) <= 500)
);

CREATE INDEX idx_reports_open    ON reports (created_at DESC) WHERE status = 'open';
CREATE INDEX idx_reports_station ON reports (station_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS reports;
