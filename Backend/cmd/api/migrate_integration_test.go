//go:build integration

package main

import (
	"bytes"
	"strings"
	"testing"

	"gostation/backend/internal/testutil"
)

// `api migrate` sur une base vide applique tout, puis ne fait plus rien ; `migrate status` liste.
func TestMigrateCommand(t *testing.T) {
	ctx := t.Context()
	dsn, stop, err := testutil.StartPostgres(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(stop)
	hex := strings.Repeat("ab", 32)
	env := map[string]string{
		"DATABASE_URL": dsn, "REDIS_URL": "redis://localhost:6379/0", "OSRM_URL": "http://localhost:5000",
		"JWT_SIGNING_KEYS": "k1:" + hex, "APP_SECRET": hex, "RATE_LIMIT_KEY": hex, "DOCUMENTS_ENCRYPTION_KEY": hex,
	}
	getenv := func(k string) string { return env[k] }

	var out bytes.Buffer
	if err := migrate(ctx, getenv, nil, &out); err != nil {
		t.Fatalf("migrate: %v\n%s", err, out.String())
	}
	if !strings.Contains(out.String(), "applied ") || !strings.Contains(out.String(), "database at version 2026") {
		t.Fatalf("first run output:\n%s", out.String())
	}
	out.Reset()
	if err := migrate(ctx, getenv, nil, &out); err != nil || !strings.Contains(out.String(), "(0 applied now)") {
		t.Fatalf("second run must apply nothing: %v\n%s", err, out.String())
	}
	out.Reset()
	if err := migrate(ctx, getenv, []string{"status"}, &out); err != nil || strings.Contains(out.String(), "pending") {
		t.Fatalf("status: %v\n%s", err, out.String())
	}
}
