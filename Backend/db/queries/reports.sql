-- Signalements, effets des seuils et alertes admin (étape 6). Une « cause » est le couple
-- (motif, produit) d'une station ; product_id est NULL sauf pour out_of_stock.

-- name: GetReportTarget :one
SELECT id, name, lat, lng, manager_id FROM stations WHERE id = @id AND status = 'approved';

-- name: StationSellsProduct :one
SELECT EXISTS (
  SELECT 1 FROM station_stocks ss JOIN products p ON p.id = ss.product_id AND p.is_active
  WHERE ss.station_id = @station_id AND ss.product_id = @product_id
)::boolean;

-- name: GetReportingBan :one
SELECT reporting_banned_at FROM users WHERE id = @id;

-- name: AdvisoryLock :exec
-- Verrou transactionnel nommé (limites par auteur, seuils par station).
SELECT pg_advisory_xact_lock(hashtextextended(@key::text, 0));

-- name: CountRecentReportsForCause :one
SELECT count(*) FROM reports
WHERE reporter_id = @reporter_id AND station_id = @station_id AND reason = @reason
  AND product_id IS NOT DISTINCT FROM sqlc.narg(product_id)::smallint
  AND created_at > @since;

-- name: CountReportsSince :one
SELECT count(*) FROM reports WHERE reporter_id = @reporter_id AND created_at >= @since;

-- name: InsertReport :one
INSERT INTO reports (station_id, product_id, reporter_id, reason, comment)
VALUES (@station_id, sqlc.narg(product_id), @reporter_id, @reason, sqlc.narg(comment))
RETURNING id, status, created_at;

-- name: CountReportersForCause :one
-- Auteurs distincts des signalements ouverts d'une cause créés après since.
SELECT count(DISTINCT reporter_id)::int FROM reports
WHERE station_id = @station_id AND reason = @reason
  AND product_id IS NOT DISTINCT FROM sqlc.narg(product_id)::smallint
  AND status = 'open' AND reporter_id IS NOT NULL AND created_at > @since;

-- name: GetReportFlag :one
SELECT id, reporters, flagged_at, excluded_at FROM station_report_flags
WHERE station_id = @station_id AND reason = @reason
  AND product_id IS NOT DISTINCT FROM sqlc.narg(product_id)::smallint;

-- name: InsertReportFlag :exec
INSERT INTO station_report_flags (station_id, reason, product_id, reporters, excluded_at)
VALUES (@station_id, @reason, sqlc.narg(product_id), @reporters, sqlc.narg(excluded_at));

-- name: UpdateReportFlag :exec
UPDATE station_report_flags SET reporters = @reporters, excluded_at = sqlc.narg(excluded_at) WHERE id = @id;

-- name: DeleteReportFlag :exec
DELETE FROM station_report_flags WHERE id = @id;

-- Clôture automatique par une action du gérant (étape 7) : une saisie ou une confirmation des
-- stocks clôt les ruptures des produits concernés (product_ids) et « station fermée » ; un
-- changement de position clôt « position incorrecte » (reasons). « Autre » ne se clôt que par
-- l'admin. Les trois requêtes partagent le même filtre de causes.

-- name: CloseReportsForCauses :execrows
UPDATE reports
SET status = 'resolved', resolution_note = @note, resolved_at = now()
WHERE station_id = @station_id AND status = 'open'
  AND (reason::text = ANY(@reasons::text[])
       OR (reason = 'out_of_stock' AND product_id = ANY(@product_ids::smallint[])));

-- name: DeleteReportFlagsForCauses :many
DELETE FROM station_report_flags
WHERE station_id = @station_id
  AND (reason::text = ANY(@reasons::text[])
       OR (reason = 'out_of_stock' AND product_id = ANY(@product_ids::smallint[])))
RETURNING reason, product_id;

-- name: AutoResolveReportAlerts :execrows
UPDATE admin_alerts SET resolved_at = now(), resolution = @resolution
WHERE station_id = @station_id AND resolved_at IS NULL AND kind = 'reports_threshold'
  AND (reason::text = ANY(@reasons::text[])
       OR (reason = 'out_of_stock' AND product_id = ANY(@product_ids::smallint[])));

-- name: ListStationReportFlags :many
SELECT f.reason, f.product_id, p.label_fr AS product_label, f.reporters, f.flagged_at, f.excluded_at
FROM station_report_flags f
LEFT JOIN products p ON p.id = f.product_id
WHERE f.station_id = @station_id
ORDER BY f.flagged_at, f.id;

-- name: ListStationReports :many
-- Vue gérant : jamais l'auteur ni son commentaire.
SELECT r.id, r.reason, r.product_id, p.label_fr AS product_label, r.status, r.created_at, r.resolved_at
FROM reports r
LEFT JOIN products p ON p.id = r.product_id
WHERE r.station_id = @station_id
  AND (NOT @open_only::boolean OR r.status = 'open')
  AND (sqlc.narg(cursor)::uuid IS NULL OR r.id < sqlc.narg(cursor)::uuid)
ORDER BY r.id DESC
LIMIT @page_size;

-- name: ListReportsForAdmin :many
SELECT r.id, r.station_id, s.name AS station_name, r.product_id, p.label_fr AS product_label,
       r.reason, r.comment, r.status, r.abusive, r.resolution_note, r.resolved_at, r.created_at,
       r.reporter_id, u.first_name AS reporter_first_name, u.last_name AS reporter_last_name,
       u.email AS reporter_email, u.reporting_banned_at AS reporter_banned_at,
       (SELECT count(*) FROM reports a WHERE a.reporter_id = r.reporter_id AND a.abusive)::int AS reporter_abusive_count
FROM reports r
JOIN stations s ON s.id = r.station_id
LEFT JOIN products p ON p.id = r.product_id
LEFT JOIN users u ON u.id = r.reporter_id
WHERE (sqlc.narg(status)::report_status IS NULL OR r.status = sqlc.narg(status)::report_status)
  AND (sqlc.narg(station_id)::uuid IS NULL OR r.station_id = sqlc.narg(station_id)::uuid)
  AND (sqlc.narg(cursor)::uuid IS NULL OR r.id < sqlc.narg(cursor)::uuid)
ORDER BY r.id DESC
LIMIT @page_size;

-- name: GetReportForAdmin :one
SELECT r.id, r.station_id, s.name AS station_name, r.product_id, p.label_fr AS product_label,
       r.reason, r.comment, r.status, r.abusive, r.resolution_note, r.resolved_at, r.created_at,
       r.reporter_id, u.first_name AS reporter_first_name, u.last_name AS reporter_last_name,
       u.email AS reporter_email, u.reporting_banned_at AS reporter_banned_at,
       (SELECT count(*) FROM reports a WHERE a.reporter_id = r.reporter_id AND a.abusive)::int AS reporter_abusive_count
FROM reports r
JOIN stations s ON s.id = r.station_id
LEFT JOIN products p ON p.id = r.product_id
LEFT JOIN users u ON u.id = r.reporter_id
WHERE r.id = @id;

-- name: GetReportForUpdate :one
SELECT id, station_id, reason, product_id, status FROM reports WHERE id = @id FOR UPDATE;

-- name: DecideReport :exec
UPDATE reports
SET status = @status, abusive = @abusive, resolved_by = @resolved_by,
    resolution_note = sqlc.narg(note), resolved_at = now()
WHERE id = @id;

-- name: CountOpenReportersForCause :one
-- Recalcul d'un effet après un classement : auteurs distincts des signalements encore ouverts.
SELECT count(DISTINCT reporter_id)::int FROM reports
WHERE station_id = @station_id AND reason = @reason
  AND product_id IS NOT DISTINCT FROM sqlc.narg(product_id)::smallint
  AND status = 'open' AND reporter_id IS NOT NULL;

-- name: SetReportingBan :execrows
UPDATE users SET reporting_banned_at = now(), reporting_ban_reason = @reason
WHERE id = @id AND role <> 'admin';

-- name: ClearReportingBan :execrows
UPDATE users SET reporting_banned_at = NULL, reporting_ban_reason = NULL WHERE id = @id;

-- name: OpenAdminAlert :one
-- Une seule alerte ouverte par cause : rien n'est créé si elle existe déjà.
INSERT INTO admin_alerts (kind, station_id, reason, product_id, details)
VALUES (@kind, @station_id, sqlc.narg(reason), sqlc.narg(product_id), @details)
ON CONFLICT (kind, station_id, reason, product_id) WHERE resolved_at IS NULL DO NOTHING
RETURNING id;

-- name: AutoResolveAdminAlerts :execrows
UPDATE admin_alerts SET resolved_at = now(), resolution = @resolution
WHERE station_id = @station_id AND resolved_at IS NULL AND kind::text = ANY(@kinds::text[]);

-- name: ListAdminAlerts :many
SELECT a.id, a.kind, a.station_id, s.name AS station_name, a.reason, a.product_id, p.label_fr AS product_label,
       a.details, a.created_at, a.resolved_at, a.resolved_by, a.resolution
FROM admin_alerts a
JOIN stations s ON s.id = a.station_id
LEFT JOIN products p ON p.id = a.product_id
WHERE (sqlc.narg(open)::boolean IS NULL OR (a.resolved_at IS NULL) = sqlc.narg(open)::boolean)
  AND (sqlc.narg(kind)::admin_alert_kind IS NULL OR a.kind = sqlc.narg(kind)::admin_alert_kind)
  AND (sqlc.narg(cursor)::uuid IS NULL OR a.id < sqlc.narg(cursor)::uuid)
ORDER BY a.id DESC
LIMIT @page_size;

-- name: ResolveAdminAlert :execrows
UPDATE admin_alerts SET resolved_at = now(), resolved_by = @resolved_by, resolution = sqlc.narg(resolution)
WHERE id = @id AND resolved_at IS NULL;

-- name: GetAdminAlert :one
SELECT a.id, a.kind, a.station_id, s.name AS station_name, a.reason, a.product_id, p.label_fr AS product_label,
       a.details, a.created_at, a.resolved_at, a.resolved_by, a.resolution
FROM admin_alerts a
JOIN stations s ON s.id = a.station_id
LEFT JOIN products p ON p.id = a.product_id
WHERE a.id = @id;
