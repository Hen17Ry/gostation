-- Durées de conservation (ARCHITECTURE §8, docs/legal/inventaire-donnees.md). Chaque règle a une
-- requête de comptage (make purge-dry-run) et une requête par lots (au plus @batch_size lignes),
-- rejouée par la tâche jusqu'à épuisement : une règle interrompue reprend où elle s'était arrêtée.

-- name: CountNotificationsBefore :one
SELECT count(*) FROM notifications WHERE created_at < @before;

-- name: DeleteNotificationsBatch :execrows
DELETE FROM notifications
WHERE id IN (SELECT x.id FROM notifications x WHERE x.created_at < @before ORDER BY x.created_at LIMIT @batch_size);

-- name: CountBackInStockAlertsBefore :one
SELECT count(*) FROM back_in_stock_alerts WHERE created_at < @before AND status <> 'pending';

-- name: DeleteBackInStockAlertsBatch :execrows
-- Journal des alertes « de retour en stock » (les limites ne regardent que les dernières 24 h).
DELETE FROM back_in_stock_alerts
WHERE id IN (SELECT x.id FROM back_in_stock_alerts x WHERE x.created_at < @before AND x.status <> 'pending'
             ORDER BY x.created_at LIMIT @batch_size);

-- name: CountInactiveDevices :one
SELECT count(*) FROM device_tokens WHERE last_seen_at < @before;

-- name: DeleteInactiveDevicesBatch :execrows
-- Tokens push sans réenregistrement depuis 90 jours.
DELETE FROM device_tokens
WHERE id IN (SELECT x.id FROM device_tokens x WHERE x.last_seen_at < @before ORDER BY x.last_seen_at LIMIT @batch_size);

-- name: CountAccountsToWarn :one
SELECT count(*) FROM users
WHERE status = 'active' AND role <> 'admin' AND last_active_at < @before AND inactivity_warned_at IS NULL;

-- name: ListAccountsToWarn :many
-- Comptes inactifs à prévenir (30 jours avant la suppression).
SELECT id, email, first_name, last_active_at FROM users
WHERE status = 'active' AND role <> 'admin' AND last_active_at < @before AND inactivity_warned_at IS NULL
ORDER BY last_active_at
LIMIT @batch_size;

-- name: MarkInactivityWarned :execrows
UPDATE users SET inactivity_warned_at = @now
WHERE id = @id AND inactivity_warned_at IS NULL AND status = 'active';

-- name: CountInactiveAccountsToDelete :one
SELECT count(*) FROM users
WHERE status = 'active' AND role <> 'admin' AND last_active_at < @before
  AND inactivity_warned_at IS NOT NULL AND inactivity_warned_at <= @warned_before;

-- name: ListInactiveAccountsToDelete :many
-- Inactifs depuis la durée de conservation, prévenus depuis au moins 30 jours sans avoir réutilisé
-- leur compte (une connexion remet inactivity_warned_at à NULL).
SELECT id, role FROM users
WHERE status = 'active' AND role <> 'admin' AND last_active_at < @before
  AND inactivity_warned_at IS NOT NULL AND inactivity_warned_at <= @warned_before
ORDER BY last_active_at
LIMIT @batch_size;

-- name: CountReportsToPseudonymize :one
SELECT count(*) FROM reports WHERE reporter_id IS NOT NULL AND created_at < @before;

-- name: ListReportsToPseudonymize :many
SELECT id, reporter_id FROM reports
WHERE reporter_id IS NOT NULL AND created_at < @before
ORDER BY created_at
LIMIT @batch_size;

-- name: PseudonymizeReports :execrows
UPDATE reports r
SET reporter_id = NULL, reporter_pseudonym = u.pseudonym, pseudonymized_at = @now
FROM (SELECT unnest(@ids::uuid[]) AS id, unnest(@pseudonyms::text[]) AS pseudonym) u
WHERE r.id = u.id AND r.reporter_id IS NOT NULL;

-- name: CountReportsBefore :one
SELECT count(*) FROM reports WHERE created_at < @before;

-- name: DeleteReportsBatch :execrows
DELETE FROM reports
WHERE id IN (SELECT x.id FROM reports x WHERE x.created_at < @before ORDER BY x.created_at LIMIT @batch_size);

-- name: CountAuditLogsBefore :one
SELECT count(*) FROM audit_logs WHERE created_at < @before;

-- name: DeleteAuditLogsBatch :execrows
DELETE FROM audit_logs
WHERE id IN (SELECT x.id FROM audit_logs x WHERE x.created_at < @before ORDER BY x.created_at, x.id LIMIT @batch_size);

-- name: CountDocumentsToDelete :one
SELECT count(*) FROM stations
WHERE document_object_key IS NOT NULL
  AND ((status = 'rejected' AND status_changed_at < @rejected_before)
       OR manager_deleted_at < @manager_deleted_before);

-- name: ListDocumentsToDelete :many
-- Justificatifs : dossier refusé sans renvoi depuis 6 mois, ou compte du gérant supprimé depuis
-- 12 mois. Celui d'une station active est conservé.
SELECT id, document_object_key FROM stations
WHERE document_object_key IS NOT NULL
  AND ((status = 'rejected' AND status_changed_at < @rejected_before)
       OR manager_deleted_at < @manager_deleted_before)
ORDER BY created_at
LIMIT @batch_size;

-- name: ClearStationDocument :execrows
UPDATE stations
SET document_object_key = NULL, document_wrapped_key = NULL, document_sha256 = NULL, document_mime = NULL,
    document_deleted_at = @now
WHERE id = @id AND document_object_key = @object_key;

-- name: CountStockHistoryBefore :one
SELECT count(*) FROM stock_history WHERE created_at < @before;

-- name: AggregateStockHistoryBatch :one
-- Historique des stocks au-delà de 12 mois : les lignes d'un lot sont supprimées et cumulées dans
-- l'agrégat journalier (jour local), sans l'auteur de la saisie. Renvoie le nombre de lignes du lot.
WITH batch AS (
  DELETE FROM stock_history
  WHERE id IN (SELECT x.id FROM stock_history x WHERE x.created_at < @before ORDER BY x.id LIMIT @batch_size)
  RETURNING station_id, product_id, quantity, created_at
), agg AS (
  SELECT (created_at AT TIME ZONE @timezone::text)::date AS day, station_id, product_id,
         count(*)::int AS changes, min(quantity) AS min_quantity, max(quantity) AS max_quantity,
         (array_agg(quantity ORDER BY created_at DESC))[1] AS last_quantity, max(created_at) AS last_at
  FROM batch
  GROUP BY 1, 2, 3
), ins AS (
  INSERT INTO stock_history_daily (day, station_id, product_id, changes, min_quantity, max_quantity, last_quantity, last_at)
  SELECT day, station_id, product_id, changes, min_quantity, max_quantity, last_quantity, last_at FROM agg
  ON CONFLICT (day, station_id, product_id) DO UPDATE SET
    changes       = stock_history_daily.changes + excluded.changes,
    min_quantity  = LEAST(stock_history_daily.min_quantity, excluded.min_quantity),
    max_quantity  = GREATEST(stock_history_daily.max_quantity, excluded.max_quantity),
    last_quantity = CASE WHEN excluded.last_at >= stock_history_daily.last_at
                         THEN excluded.last_quantity ELSE stock_history_daily.last_quantity END,
    last_at       = GREATEST(stock_history_daily.last_at, excluded.last_at)
  RETURNING 1
)
SELECT count(*)::bigint FROM batch;

-- name: CountClosedDataRequestsBefore :one
SELECT count(*) FROM data_requests WHERE status IN ('completed', 'rejected') AND completed_at < @before;

-- name: DeleteClosedDataRequestsBatch :execrows
-- Preuve de conformité : demandes closes depuis 3 ans.
DELETE FROM data_requests
WHERE id IN (SELECT x.id FROM data_requests x WHERE x.status IN ('completed', 'rejected') AND x.completed_at < @before
             ORDER BY x.completed_at LIMIT @batch_size);

-- name: CountResolvedAdminAlertsBefore :one
SELECT count(*) FROM admin_alerts WHERE resolved_at < @before;

-- name: DeleteResolvedAdminAlertsBatch :execrows
DELETE FROM admin_alerts
WHERE id IN (SELECT a.id FROM admin_alerts a WHERE a.resolved_at < @before ORDER BY a.resolved_at LIMIT @batch_size);

-- name: CountExportRecordsBefore :one
SELECT count(*) FROM exports WHERE created_at < @before AND status <> 'ready';

-- name: DeleteExportRecordsBatch :execrows
-- Métadonnées des exports admin (les fichiers, eux, sont supprimés 24 h après leur génération).
DELETE FROM exports
WHERE id IN (SELECT e.id FROM exports e WHERE e.created_at < @before AND e.status <> 'ready'
             ORDER BY e.created_at LIMIT @batch_size);
