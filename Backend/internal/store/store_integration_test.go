//go:build integration

package store_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
	"gostation/backend/internal/testutil"
)

// testPool est le pool du PostGIS migré du paquet, démarré une fois dans TestMain.
var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	pool, _, stop, err := testutil.StartMigratedPostgres(context.Background())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	testPool = pool
	return m.Run()
}

func TestListActiveProducts(t *testing.T) {
	s := store.New(testPool)
	rows, err := s.ListActiveProducts(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	want := []struct {
		code string
		unit dbgen.ProductUnit
		size *float64
	}{
		{"lpg_5kg", dbgen.ProductUnitCylinder, ptr(5.0)},
		{"lpg_10kg", dbgen.ProductUnitCylinder, ptr(10.0)},
		{"lpg_25kg", dbgen.ProductUnitCylinder, ptr(25.0)},
		{"petrol", dbgen.ProductUnitLiter, nil},
		{"diesel", dbgen.ProductUnitLiter, nil},
	}
	if len(rows) != len(want) {
		t.Fatalf("got %d products, want %d: %+v", len(rows), len(want), rows)
	}
	for i, w := range want {
		r := rows[i]
		if r.Code != w.code || r.Unit != w.unit || !equalPtr(r.SizeKg, w.size) {
			t.Errorf("product %d = %s %s %v, want %s %s %v", i, r.Code, r.Unit, deref(r.SizeKg), w.code, w.unit, deref(w.size))
		}
	}

	// Un produit désactivé disparaît du catalogue public.
	if _, err := testPool.Exec(t.Context(), `UPDATE products SET is_active = false WHERE code = 'lpg_25kg'`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `UPDATE products SET is_active = true WHERE code = 'lpg_25kg'`)
	})
	rows, err = s.ListActiveProducts(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 4 {
		t.Errorf("got %d active products, want 4", len(rows))
	}
}

func insertStation(t *testing.T, ifu string, lngLat *[2]float64) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	q := `INSERT INTO stations (name, ifu, rccm, address, phone, location)
		VALUES ('Station Akpakpa', $1, 'RB/COT/24 B 1', 'Akpakpa', '+22990000001',
		        CASE WHEN $2::float8 IS NULL THEN NULL
		             ELSE ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography END)
		RETURNING id`
	var lng, lat *float64
	if lngLat != nil {
		lng, lat = &lngLat[0], &lngLat[1]
	}
	if err := testPool.QueryRow(t.Context(), q, ifu, lng, lat).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestGetStationByID(t *testing.T) {
	s := store.New(testPool)

	t.Run("pinned station returns lat/lng", func(t *testing.T) {
		id := insertStation(t, "1201234567890", &[2]float64{2.4498, 6.3601})
		st, err := s.GetStationByID(t.Context(), id)
		if err != nil {
			t.Fatal(err)
		}
		if st.Lat == nil || st.Lng == nil || *st.Lat != 6.3601 || *st.Lng != 2.4498 {
			t.Errorf("lat/lng = %v/%v, want 6.3601/2.4498", deref(st.Lat), deref(st.Lng))
		}
		if st.Status != dbgen.StationStatusPending || st.Ifu != "1201234567890" || st.CreatedAt.IsZero() {
			t.Errorf("unexpected station %+v", st)
		}
	})
	t.Run("unpinned station has nil lat/lng", func(t *testing.T) {
		id := insertStation(t, "1201234567891", nil)
		st, err := s.GetStationByID(t.Context(), id)
		if err != nil {
			t.Fatal(err)
		}
		if st.Lat != nil || st.Lng != nil {
			t.Errorf("lat/lng = %v/%v, want nil", deref(st.Lat), deref(st.Lng))
		}
	})
	t.Run("unknown id translates to resource.not_found", func(t *testing.T) {
		_, err := s.GetStationByID(t.Context(), uuid.Must(uuid.NewV7()))
		if !apperr.HasCode(store.Translate(err), apperr.CodeNotFound) {
			t.Errorf("Translate(%v) is not resource.not_found", err)
		}
	})
}

func TestTranslateUniqueViolation(t *testing.T) {
	insert := `INSERT INTO users (email, password_hash, first_name, last_name, privacy_policy_version, privacy_accepted_at)
		VALUES ('dup@example.bj', 'x', 'A', 'B', '2026-10', now())`
	if _, err := testPool.Exec(t.Context(), insert); err != nil {
		t.Fatal(err)
	}
	_, err := testPool.Exec(t.Context(), insert)
	if !apperr.HasCode(store.Translate(err), apperr.CodeConflict) || store.ConstraintName(err) != "uq_users_email" {
		t.Errorf("Translate(%v) is not a conflict on uq_users_email", err)
	}
}

func TestInTx(t *testing.T) {
	s := store.New(testPool)
	sentinel := errors.New("abort")
	err := s.InTx(t.Context(), func(q *dbgen.Queries) error {
		rows, err := q.ListActiveProducts(t.Context())
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return errors.New("no products visible inside the transaction")
		}
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Errorf("InTx error = %v, want the callback error", err)
	}
	if err := s.InTx(t.Context(), func(*dbgen.Queries) error { return nil }); err != nil {
		t.Errorf("InTx commit: %v", err)
	}
}

func ptr[T any](v T) *T { return &v }

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func equalPtr(a, b *float64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
