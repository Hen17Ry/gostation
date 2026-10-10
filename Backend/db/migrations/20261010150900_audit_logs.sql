-- Journal d'audit en ajout seul. Les droits (INSERT/SELECT pour le rôle applicatif, DELETE pour
-- le rôle de purge) seront posés à l'étape déploiement ; le trigger interdit déjà toute modification.

-- +goose Up
CREATE TABLE audit_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY,
  actor_id     uuid,
  actor_role   user_role,
  action       text        NOT NULL,
  entity_type  text        NOT NULL,
  entity_id    text,
  metadata     jsonb       NOT NULL DEFAULT '{}',
  request_id   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_audit_logs PRIMARY KEY (id),
  CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor  ON audit_logs (actor_id, created_at DESC);

-- +goose StatementBegin
CREATE FUNCTION audit_logs_forbid_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Seule exception : la mise à NULL de actor_id par ON DELETE SET NULL (suppression d'un compte).
  IF NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
     AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_forbid_update();

-- +goose Down
DROP TABLE IF EXISTS audit_logs;
DROP FUNCTION IF EXISTS audit_logs_forbid_update();
