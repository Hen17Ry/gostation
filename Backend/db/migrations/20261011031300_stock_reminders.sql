-- Rappels de mise à jour des stocks (étape 6) : état du jour par station, dans une table à part
-- pour que le worker n'écrive jamais dans stations (verrouillage optimiste, updated_at).
-- Remplace stations.last_reminder_at, jamais utilisé.

-- +goose Up
CREATE TABLE station_reminders (
  station_id    uuid        NOT NULL,
  day           date        NOT NULL,                 -- journée locale (Africa/Porto-Novo) des compteurs
  sent          smallint    NOT NULL DEFAULT 0,       -- rappels envoyés ce jour-là (plafond 4)
  streak        smallint    NOT NULL DEFAULT 0,       -- rappels envoyés depuis la dernière mise à jour
  stopped       boolean     NOT NULL DEFAULT false,   -- 3 rappels ignorés : arrêt jusqu'au lendemain
  last_sent_at  timestamptz,
  muted_until   timestamptz,                          -- sourdine jusqu'à la fermeture du jour
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_station_reminders PRIMARY KEY (station_id),
  CONSTRAINT fk_station_reminders_station FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE,
  CONSTRAINT ck_station_reminders_counts CHECK (sent >= 0 AND streak >= 0)
);

ALTER TABLE stations DROP COLUMN last_reminder_at;

-- +goose Down
ALTER TABLE stations ADD COLUMN last_reminder_at timestamptz;
DROP TABLE IF EXISTS station_reminders;
