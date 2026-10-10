//go:build integration

package db_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"gostation/backend/internal/testutil"
)

// testDSN pointe vers le PostGIS du paquet, démarré une fois dans TestMain.
var testDSN string

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	dsn, stop, err := testutil.StartPostgres(context.Background())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	testDSN = dsn
	return m.Run()
}

// appTables sont les tables créées par les migrations (ARCHITECTURE §3).
var appTables = []string{
	"admin_recovery_codes", "audit_logs", "country_boundaries", "data_requests", "device_tokens", "favorites", "products",
	"reports", "search_stats", "station_closures", "station_location_requests", "station_opening_hours", "station_stocks",
	"stations", "stock_history", "users",
}

func TestMigrationsUpDownUp(t *testing.T) {
	ctx := t.Context()
	p, sqlDB, err := testutil.NewMigrator(testDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = sqlDB.Close() }()
	total := len(p.ListSources())

	assertState := func(t *testing.T, step string, wantTables, wantEnums, wantProducts int) {
		t.Helper()
		var tables, enums int
		if err := sqlDB.QueryRowContext(ctx, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public'
			AND tablename = ANY($1)`, appTables).Scan(&tables); err != nil {
			t.Fatal(err)
		}
		if err := sqlDB.QueryRowContext(ctx, `SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
			WHERE n.nspname = 'public' AND t.typtype = 'e'`).Scan(&enums); err != nil {
			t.Fatal(err)
		}
		if tables != wantTables || enums != wantEnums {
			t.Errorf("%s: %d tables, %d enums; want %d, %d", step, tables, enums, wantTables, wantEnums)
		}
		if wantProducts >= 0 {
			var products int
			if err := sqlDB.QueryRowContext(ctx, `SELECT count(*) FROM products`).Scan(&products); err != nil {
				t.Fatal(err)
			}
			if products != wantProducts {
				t.Errorf("%s: %d products, want %d", step, products, wantProducts)
			}
		}
	}

	up, err := p.Up(ctx)
	if err != nil {
		t.Fatalf("first up: %v", err)
	}
	if len(up) != total {
		t.Fatalf("first up applied %d migrations, want %d", len(up), total)
	}
	assertState(t, "after up", len(appTables), 12, 5)

	down, err := p.DownTo(ctx, 0)
	if err != nil {
		t.Fatalf("down to 0: %v", err)
	}
	if len(down) != total {
		t.Fatalf("down rolled back %d migrations, want %d", len(down), total)
	}
	assertState(t, "after down", 0, 0, -1)
	var leftovers int
	if err := sqlDB.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM pg_proc WHERE proname IN ('set_updated_at', 'set_stock_updated_at', 'audit_logs_forbid_update')) +
		(SELECT count(*) FROM pg_extension WHERE extname = 'citext')`).Scan(&leftovers); err != nil {
		t.Fatal(err)
	}
	if leftovers != 0 {
		t.Errorf("after down: %d functions/extensions left behind", leftovers)
	}

	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("second up: %v", err)
	}
	assertState(t, "after second up", len(appTables), 12, 5)
}

// migratedPool garantit un schéma à jour (Up est idempotent) et ouvre un pool.
func migratedPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if err := testutil.MigrateUp(t.Context(), testDSN); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(t.Context(), testDSN)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func insertUser(t *testing.T, pool *pgxpool.Pool, email string) (uuid.UUID, error) {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(t.Context(), `INSERT INTO users (email, password_hash, first_name, last_name, privacy_policy_version, privacy_accepted_at)
		VALUES ($1, 'argon2id$test', 'Kofi', 'Mensah', '2026-10', now()) RETURNING id`, email).Scan(&id)
	return id, err
}

func insertStation(t *testing.T, pool *pgxpool.Pool, managerID *uuid.UUID, ifu string) (uuid.UUID, error) {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(t.Context(), `INSERT INTO stations (manager_id, name, ifu, rccm, address, phone)
		VALUES ($1, 'Station Dantokpa', $2, 'RB/COT/24 B 12345', 'Rue du marché', '+22990000000') RETURNING id`,
		managerID, ifu).Scan(&id)
	return id, err
}

func mustNoErr(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func assertViolation(t *testing.T, err error, constraint string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.ConstraintName != constraint {
		t.Fatalf("error = %v, want violation of %s", err, constraint)
	}
}

func TestConstraints(t *testing.T) {
	pool := migratedPool(t)
	ctx := t.Context()

	t.Run("primary keys are UUIDv7", func(t *testing.T) {
		id, err := insertUser(t, pool, "v7@example.bj")
		mustNoErr(t, err)
		if id.Version() != 7 {
			t.Errorf("id %s is version %d, want 7", id, id.Version())
		}
	})
	t.Run("email is unique case-insensitively", func(t *testing.T) {
		_, err := insertUser(t, pool, "Afi.Dossou@Example.bj")
		mustNoErr(t, err)
		_, err = insertUser(t, pool, "afi.dossou@example.BJ")
		assertViolation(t, err, "uq_users_email")
	})
	t.Run("IFU must be 13 digits", func(t *testing.T) {
		for _, ifu := range []string{"12345", "12345678901AB"} {
			_, err := insertStation(t, pool, nil, ifu)
			assertViolation(t, err, "ck_stations_ifu")
		}
	})
	t.Run("stock quantities cannot be negative", func(t *testing.T) {
		st, err := insertStation(t, pool, nil, "3201234567890")
		mustNoErr(t, err)
		_, err = pool.Exec(ctx, `INSERT INTO station_stocks (station_id, product_id, quantity)
			SELECT $1, id, -1 FROM products WHERE code = 'petrol'`, st)
		assertViolation(t, err, "ck_station_stocks_quantity")
	})
	t.Run("one product per kind and size", func(t *testing.T) {
		_, err := pool.Exec(ctx, `INSERT INTO products (code, kind, unit, size_kg, label_fr)
			VALUES ('lpg_5kg_bis', 'lpg', 'cylinder', 5, 'Gaz 5 kg bis')`)
		assertViolation(t, err, "uq_products_kind_size")
		_, err = pool.Exec(ctx, `INSERT INTO products (code, kind, unit, label_fr) VALUES ('petrol_bis', 'petrol', 'liter', 'Essence bis')`)
		assertViolation(t, err, "uq_products_kind_size")
		_, err = pool.Exec(ctx, `INSERT INTO products (code, kind, unit, label_fr) VALUES ('lpg_nosize', 'lpg', 'cylinder', 'Gaz ?')`)
		assertViolation(t, err, "ck_products_kind_unit")
	})
	t.Run("lat/lng are generated from location", func(t *testing.T) {
		st, err := insertStation(t, pool, nil, "3201234567891")
		mustNoErr(t, err)
		var lat, lng *float64
		mustNoErr(t, pool.QueryRow(ctx, `SELECT lat, lng FROM stations WHERE id = $1`, st).Scan(&lat, &lng))
		if lat != nil || lng != nil {
			t.Fatalf("unpinned station has lat/lng %v/%v", lat, lng)
		}
		mustNoErr(t, pool.QueryRow(ctx, `UPDATE stations SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
			WHERE id = $1 RETURNING lat, lng`, st, 2.4253, 6.3703).Scan(&lat, &lng))
		if lat == nil || lng == nil || *lat != 6.3703 || *lng != 2.4253 {
			t.Fatalf("lat/lng = %v/%v, want 6.3703/2.4253", lat, lng)
		}
	})
	t.Run("updated_at trigger", func(t *testing.T) {
		st, err := insertStation(t, pool, nil, "3201234567892")
		mustNoErr(t, err)
		stale := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
		mustNoErr(t, pool.QueryRow(ctx, `UPDATE stations SET updated_at = $2 WHERE id = $1 RETURNING updated_at`, st, stale).Scan(new(time.Time)))
		var explicit, bumped time.Time
		mustNoErr(t, pool.QueryRow(ctx, `SELECT updated_at FROM stations WHERE id = $1`, st).Scan(&explicit))
		if !explicit.Equal(stale) {
			t.Fatalf("explicit updated_at = %s, want %s (kept)", explicit, stale)
		}
		mustNoErr(t, pool.QueryRow(ctx, `UPDATE stations SET name = 'Renamed' WHERE id = $1 RETURNING updated_at`, st).Scan(&bumped))
		if time.Since(bumped) > time.Minute {
			t.Fatalf("updated_at = %s, want now()", bumped)
		}
	})
	t.Run("foreign keys: SET NULL, CASCADE, RESTRICT", func(t *testing.T) {
		manager, err := insertUser(t, pool, "manager@example.bj")
		mustNoErr(t, err)
		st, err := insertStation(t, pool, &manager, "3201234567893")
		mustNoErr(t, err)
		_, err = pool.Exec(ctx, `INSERT INTO station_stocks (station_id, product_id, quantity)
			SELECT $1, id, 12 FROM products WHERE code = 'lpg_10kg'`, st)
		mustNoErr(t, err)

		_, err = pool.Exec(ctx, `DELETE FROM products WHERE code = 'lpg_10kg'`)
		assertViolation(t, err, "fk_station_stocks_product")

		_, err = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, manager)
		mustNoErr(t, err)
		var managerID *uuid.UUID
		mustNoErr(t, pool.QueryRow(ctx, `SELECT manager_id FROM stations WHERE id = $1`, st).Scan(&managerID))
		if managerID != nil {
			t.Errorf("manager_id = %v after manager deletion, want NULL", managerID)
		}

		_, err = pool.Exec(ctx, `DELETE FROM stations WHERE id = $1`, st)
		mustNoErr(t, err)
		var stocks int
		mustNoErr(t, pool.QueryRow(ctx, `SELECT count(*) FROM station_stocks WHERE station_id = $1`, st).Scan(&stocks))
		if stocks != 0 {
			t.Errorf("%d stocks left after station deletion, want 0 (cascade)", stocks)
		}
	})
	t.Run("stock updated_at moves only when the quantity changes", func(t *testing.T) {
		st, err := insertStation(t, pool, nil, "3201234567894")
		mustNoErr(t, err)
		_, err = pool.Exec(ctx, `INSERT INTO station_stocks (station_id, product_id, quantity, updated_at)
			SELECT $1, id, 5, '2026-01-01T00:00:00Z' FROM products WHERE code = 'diesel'`, st)
		mustNoErr(t, err)
		var updated time.Time
		mustNoErr(t, pool.QueryRow(ctx, `UPDATE station_stocks SET last_confirmed_at = now() WHERE station_id = $1 RETURNING updated_at`, st).Scan(&updated))
		if updated.Year() != 2026 || updated.Month() != 1 {
			t.Fatalf("confirmation moved updated_at to %s", updated)
		}
		mustNoErr(t, pool.QueryRow(ctx, `UPDATE station_stocks SET quantity = 6 WHERE station_id = $1 RETURNING updated_at`, st).Scan(&updated))
		if time.Since(updated) > time.Minute {
			t.Fatalf("quantity change did not move updated_at (%s)", updated)
		}
	})
	t.Run("one pending location request per station", func(t *testing.T) {
		st, err := insertStation(t, pool, nil, "3201234567895")
		mustNoErr(t, err)
		insert := `INSERT INTO station_location_requests (station_id, location, h3_r8, distance_m)
			VALUES ($1, ST_SetSRID(ST_MakePoint(2.42, 6.37), 4326)::geography, 1, 500)`
		_, err = pool.Exec(ctx, insert, st)
		mustNoErr(t, err)
		_, err = pool.Exec(ctx, insert, st)
		assertViolation(t, err, "uq_station_location_requests_pending")
	})
	t.Run("audit_logs is append-only", func(t *testing.T) {
		actor, err := insertUser(t, pool, "admin@example.bj")
		mustNoErr(t, err)
		var id int64
		mustNoErr(t, pool.QueryRow(ctx, `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type)
			VALUES ($1, 'admin', 'station.approve', 'station') RETURNING id`, actor).Scan(&id))
		_, err = pool.Exec(ctx, `UPDATE audit_logs SET action = 'station.reject' WHERE id = $1`, id)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			t.Fatalf("update error = %v, want insufficient_privilege", err)
		}
		// La suppression du compte anonymise l'entrée (ON DELETE SET NULL) au lieu d'échouer.
		_, err = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, actor)
		mustNoErr(t, err)
		var actorID *uuid.UUID
		mustNoErr(t, pool.QueryRow(ctx, `SELECT actor_id FROM audit_logs WHERE id = $1`, id).Scan(&actorID))
		if actorID != nil {
			t.Errorf("actor_id = %v after user deletion, want NULL", actorID)
		}
	})
}
