//go:build integration

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"gostation/backend/internal/testutil"
)

var (
	testPool *pgxpool.Pool
	testEnv  map[string]string
)

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func secret() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func runTests(m *testing.M) int {
	ctx := context.Background()
	pool, dsn, stopPG, err := testutil.StartMigratedPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stopPG()
	redisURL, stopRedis, err := testutil.StartRedis(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stopRedis()
	testPool = pool
	testEnv = map[string]string{
		"DATABASE_URL": dsn, "REDIS_URL": redisURL, "OSRM_URL": "http://127.0.0.1:9",
		"JWT_SIGNING_KEYS": "k1:" + secret(), "APP_SECRET": secret(), "DOCUMENTS_ENCRYPTION_KEY": secret(),
	}
	return m.Run()
}

func runCLI(t *testing.T, stdin string, args ...string) (string, error) {
	t.Helper()
	var out, errOut bytes.Buffer
	err := run(t.Context(), args, func(k string) string { return testEnv[k] }, strings.NewReader(stdin), &out, &errOut)
	return out.String(), err
}

func TestCreateAdmin(t *testing.T) {
	email := testutil.UniqueEmail("ada")
	out, err := runCLI(t, "Lagune-Cotonou-88\n", "create", "--email", email, "--first-name", "Ada", "--last-name", "Admin")
	if err != nil || !strings.Contains(out, "Admin created: "+email) {
		t.Fatalf("create = %q, %v", out, err)
	}
	var role string
	var verified bool
	if err := testPool.QueryRow(t.Context(), `SELECT role, email_verified_at IS NOT NULL FROM users WHERE email = $1`, email).Scan(&role, &verified); err != nil {
		t.Fatal(err)
	}
	if role != "admin" || !verified {
		t.Errorf("created account: role=%s verified=%v", role, verified)
	}

	if _, err := runCLI(t, "Lagune-Cotonou-88\n", "create", "--email", strings.ToUpper(email), "--first-name", "Ada", "--last-name", "Bis"); err == nil {
		t.Error("duplicate admin email accepted")
	}
	_, err = runCLI(t, "password123\n", "create", "--email", "weak@gostation.bj", "--first-name", "W", "--last-name", "K")
	if err == nil || !strings.Contains(describe(err), "password: is too common") {
		t.Errorf("weak password: %v", err)
	}
	if _, err := runCLI(t, "", "create", "--email", "empty@gostation.bj", "--first-name", "E", "--last-name", "P"); err == nil {
		t.Error("empty password accepted")
	}
}

func TestResetTwoFactor(t *testing.T) {
	email := testutil.UniqueEmail("grace")
	if _, err := runCLI(t, "Lagune-Cotonou-88\n", "create", "--email", email, "--first-name", "Grace", "--last-name", "Admin"); err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(t.Context(), `UPDATE users SET totp_secret_encrypted = '\x01', totp_enabled_at = now() WHERE email = $1`, email); err != nil {
		t.Fatal(err)
	}
	out, err := runCLI(t, "", "reset-2fa", "--email", email)
	if err != nil || !strings.Contains(out, "Two-factor authentication reset") {
		t.Fatalf("reset-2fa = %q, %v", out, err)
	}
	var enabled bool
	if err := testPool.QueryRow(t.Context(), `SELECT totp_enabled_at IS NOT NULL FROM users WHERE email = $1`, email).Scan(&enabled); err != nil || enabled {
		t.Fatalf("2FA still enabled: %v %v", enabled, err)
	}
	if _, err := runCLI(t, "", "reset-2fa", "--email", "nobody@gostation.bj"); err == nil {
		t.Error("reset-2fa on unknown account succeeded")
	}
}

func TestUsageErrors(t *testing.T) {
	for _, args := range [][]string{{}, {"create"}, {"create", "--email", "a@b.bj"}, {"explode", "--email", "a@b.bj"}} {
		if _, err := runCLI(t, "", args...); err == nil {
			t.Errorf("run(%v) succeeded", args)
		}
	}
}
