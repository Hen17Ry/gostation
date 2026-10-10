-- Demandes d'exercice des droits (APDP / RGPD).

-- +goose Up
CREATE TABLE data_requests (
  id                 uuid                NOT NULL DEFAULT uuidv7(),
  user_id            uuid,
  type               data_request_type   NOT NULL,
  status             data_request_status NOT NULL DEFAULT 'pending',
  details            text,
  due_at             timestamptz         NOT NULL,
  handled_by         uuid,
  response_note      text,
  export_object_key  text,
  created_at         timestamptz         NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  CONSTRAINT pk_data_requests PRIMARY KEY (id),
  CONSTRAINT fk_data_requests_user    FOREIGN KEY (user_id)    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_data_requests_handler FOREIGN KEY (handled_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX idx_data_requests_status ON data_requests (status, due_at);

-- +goose Down
DROP TABLE IF EXISTS data_requests;
