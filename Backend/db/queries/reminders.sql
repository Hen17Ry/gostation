-- Rappels de mise à jour des stocks (étape 6). « Ouverte maintenant » reprend le filtre de la
-- recherche (search.sql) : jour ISO, heure et dates locales calculés en Go, fuseau Africa/Porto-Novo.

-- name: ListReminderCandidates :many
-- Stations approuvées qui vendent au moins un produit, sans mise à jour ni confirmation depuis
-- stale_before, sans rappel depuis stale_before, ni en sourdine ni en opt-out. Deux cas :
--   * streak ≥ max_ignored : rappels ignorés de suite, à escalader (ouverte ou non) ;
--   * sinon : ouverte maintenant, sous le plafond du jour, rappels non arrêtés aujourd'hui.
SELECT s.id, s.name, s.manager_id, s.version, s.last_stock_update_at,
       COALESCE(r.streak, 0)::smallint AS streak
FROM stations s
LEFT JOIN station_reminders r ON r.station_id = s.id
WHERE s.status = 'approved'
  AND s.manager_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM station_stocks ss WHERE ss.station_id = s.id)
  AND (s.last_stock_update_at IS NULL OR s.last_stock_update_at <= @stale_before::timestamptz)
  AND (r.last_sent_at IS NULL OR r.last_sent_at <= @stale_before::timestamptz)
  AND (r.muted_until IS NULL OR r.muted_until <= @now::timestamptz)
  AND NOT EXISTS (SELECT 1 FROM notification_opt_outs o WHERE o.user_id = s.manager_id AND o.type = 'stock_reminder')
  AND (
    COALESCE(r.streak, 0) >= @max_ignored::smallint
    OR (
      (r.day IS NULL OR r.day <> @local_date::date OR (NOT r.stopped AND r.sent < @max_per_day::smallint))
      AND s.id NOT IN (SELECT c.station_id FROM station_closures c WHERE c.closed_on = @local_date::date)
      AND EXISTS (
        SELECT 1 FROM station_opening_hours h
        WHERE h.station_id = s.id AND (
          (h.weekday = @isodow::smallint AND @local_time::time >= h.opens_at
            AND (h.closes_at <= h.opens_at OR @local_time::time < h.closes_at))
          OR (h.weekday = @prev_isodow::smallint AND h.closes_at <= h.opens_at AND @local_time::time < h.closes_at
            AND NOT EXISTS (SELECT 1 FROM station_closures c WHERE c.station_id = s.id AND c.closed_on = @prev_date::date))))
    )
  )
ORDER BY s.id;

-- name: RecordReminderSent :exec
-- Compteurs du jour remis à zéro au changement de journée locale ; streak (rappels depuis la
-- dernière mise à jour) n'est remis à zéro que par une mise à jour ou une escalade.
INSERT INTO station_reminders (station_id, day, sent, streak, last_sent_at, updated_at)
VALUES (@station_id, @local_date, 1, 1, @now::timestamptz, @now::timestamptz)
ON CONFLICT (station_id) DO UPDATE
SET sent         = CASE WHEN station_reminders.day = EXCLUDED.day THEN station_reminders.sent + 1 ELSE 1 END,
    stopped      = CASE WHEN station_reminders.day = EXCLUDED.day THEN station_reminders.stopped ELSE false END,
    streak       = station_reminders.streak + 1,
    day          = EXCLUDED.day,
    last_sent_at = EXCLUDED.last_sent_at,
    updated_at   = EXCLUDED.updated_at;

-- name: StopReminders :exec
-- Escalade après les rappels ignorés : arrêt pour la journée du dernier rappel (day), reprise le
-- lendemain (RecordReminderSent remet stopped à false au changement de jour).
UPDATE station_reminders SET stopped = true, streak = 0, updated_at = @now WHERE station_id = @station_id;

-- name: MuteReminders :one
INSERT INTO station_reminders (station_id, day, muted_until, updated_at)
VALUES (@station_id, @local_date, @muted_until, now())
ON CONFLICT (station_id) DO UPDATE SET muted_until = EXCLUDED.muted_until, updated_at = now()
RETURNING muted_until;

-- name: ResetReminderStreak :exec
-- Mise à jour ou confirmation du gérant : le rappel en cours n'est plus « ignoré ».
UPDATE station_reminders SET streak = 0, updated_at = now() WHERE station_id = @station_id AND streak <> 0;

-- name: GetReminderState :one
SELECT station_id, day, sent, streak, stopped, last_sent_at, muted_until
FROM station_reminders WHERE station_id = @station_id;
