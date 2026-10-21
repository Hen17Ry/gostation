package main

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"gostation/backend/internal/platform/storage"
	"gostation/backend/internal/searchcache"
)

// testEmails reconnaît les comptes des tests : fixtures et admins de Playwright (example.bj),
// parcours Maestro (example.test). Ce sont des domaines réservés : jamais un vrai compte.
const testEmails = `lower(email) ~ '@example\.(bj|test)$'`

// cleanup supprime d'une base de staging tout ce que les tests E2E y ont créé : comptes de test,
// leurs stations (justificatifs compris), leurs signalements, demandes, exports et lignes
// d'audit, le produit créé par les fixtures, puis leurs fichiers chiffrés et leurs sessions. Les
// stations fictives (is_demo) et les comptes réels restent. Idempotent.
func cleanup(ctx context.Context, getenv func(string) string, out io.Writer) error {
	e, done, err := open(ctx, getenv)
	if err != nil {
		return err
	}
	defer done()

	var users []uuid.UUID
	var keys []string
	counts := map[string]int64{}
	err = pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error {
		steps := []struct{ name, sql string }{
			{"users", `CREATE TEMP TABLE t_users ON COMMIT DROP AS SELECT id FROM users WHERE ` + testEmails},
			{"stations", `CREATE TEMP TABLE t_stations ON COMMIT DROP AS
				SELECT id, document_object_key FROM stations WHERE manager_id IN (SELECT id FROM t_users) AND NOT is_demo`},
			// Produits créés par un compte de test d'après l'audit, et celui des fixtures laissé
			// désactivé par un nettoyage précédent (encore référencé alors).
			{"products", `CREATE TEMP TABLE t_products ON COMMIT DROP AS
				SELECT entity_id::smallint AS id FROM audit_logs
				WHERE action = 'product.created' AND actor_id IN (SELECT id FROM t_users)
				UNION SELECT id FROM products WHERE code = '` + fixtureProductCode + `' AND label_fr = 'Gaz 7,5 kg'`},
			{"files", `CREATE TEMP TABLE t_files ON COMMIT DROP AS
				SELECT document_object_key AS k FROM t_stations WHERE document_object_key IS NOT NULL
				UNION SELECT object_key FROM personal_exports WHERE user_id IN (SELECT id FROM t_users) AND object_key IS NOT NULL
				UNION SELECT object_key FROM exports WHERE requested_by IN (SELECT id FROM t_users) AND object_key IS NOT NULL`},
		}
		for _, s := range steps {
			tag, err := tx.Exec(ctx, s.sql)
			if err != nil {
				return fmt.Errorf("cleanup %s: %w", s.name, err)
			}
			counts[s.name] = tag.RowsAffected()
		}
		rows, err := tx.Query(ctx, `SELECT id FROM t_users`)
		if err != nil {
			return err
		}
		if users, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID]); err != nil {
			return err
		}
		rows, err = tx.Query(ctx, `SELECT k FROM t_files`)
		if err != nil {
			return err
		}
		if keys, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		for _, s := range []struct{ name, sql string }{
			{"audit", `DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM t_users)
				OR (entity_type = 'user' AND entity_id IN (SELECT id::text FROM t_users))
				OR (entity_type = 'station' AND entity_id IN (SELECT id::text FROM t_stations))`},
			{"reports", `DELETE FROM reports WHERE reporter_id IN (SELECT id FROM t_users)`},
			{"data requests", `DELETE FROM data_requests WHERE user_id IN (SELECT id FROM t_users)`},
			{"exports", `DELETE FROM exports WHERE requested_by IN (SELECT id FROM t_users)`},
			{"stations deleted", `DELETE FROM stations WHERE id IN (SELECT id FROM t_stations)`},
			{"users deleted", `DELETE FROM users WHERE id IN (SELECT id FROM t_users)`},
		} {
			tag, err := tx.Exec(ctx, s.sql)
			if err != nil {
				return fmt.Errorf("cleanup %s: %w", s.name, err)
			}
			counts[s.name] = tag.RowsAffected()
		}
		// Un produit encore référencé (statistiques de recherche…) est désactivé au lieu d'être
		// supprimé : il disparaît de l'app et de la recherche.
		if _, err := tx.Exec(ctx, `SAVEPOINT products`); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM products WHERE id IN (SELECT id FROM t_products)`)
		if err != nil {
			if _, err := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT products`); err != nil {
				return err
			}
			tag, err = tx.Exec(ctx, `UPDATE products SET is_active = false WHERE id IN (SELECT id FROM t_products)`)
			if err != nil {
				return fmt.Errorf("cleanup products: %w", err)
			}
		}
		counts["products"] = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return err
	}

	var failed int
	for _, k := range keys {
		if err := e.storage.Delete(ctx, k); err != nil && !errors.Is(err, storage.ErrNotFound) {
			failed++
		}
	}
	for _, uid := range users {
		if err := e.svc.Sessions.RevokeAll(ctx, uid, ""); err != nil {
			return fmt.Errorf("revoke sessions: %w", err)
		}
	}
	if err := searchcache.New(e.rdb).All(ctx); err != nil {
		return fmt.Errorf("search cache: %w", err)
	}
	fmt.Fprintf(out, "test data deleted: %d accounts, %d stations, %d reports, %d data requests, %d exports, %d audit rows, %d products, %d files (%d failed)\n",
		counts["users deleted"], counts["stations deleted"], counts["reports"], counts["data requests"], counts["exports"],
		counts["audit"], counts["products"], len(keys)-failed, failed)
	if failed > 0 {
		return fmt.Errorf("%d files not deleted", failed)
	}
	return nil
}
