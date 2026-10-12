//go:build integration

package testutil

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	goredis "github.com/redis/go-redis/v9"
)

// Isolation des tests d'intégration : chaque test doit passer seul, dans n'importe quel ordre et
// rejoué (`go test -count=10 -tags integration`). Les tests d'un paquet ne tournent jamais en
// parallèle (pas de t.Parallel) : réinitialiser un état partagé au début d'un test est sûr.

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// UniqueEmail renvoie une adresse propre à un appel : rejouer un test ne heurte jamais l'unicité.
func UniqueEmail(prefix string) string {
	return prefix + "." + randomHex(6) + "@example.bj"
}

// ResetRedis vide la base Redis du client au début du test et à sa fin : quotas, compteurs et
// caches ne débordent pas d'un test (ou d'une itération) sur l'autre.
func ResetRedis(t testing.TB, rdb goredis.UniversalClient) {
	t.Helper()
	flush := func() {
		if err := rdb.FlushDB(context.WithoutCancel(t.Context())).Err(); err != nil {
			t.Fatalf("flush redis: %v", err)
		}
	}
	flush()
	t.Cleanup(flush)
}

var (
	templateOnce sync.Once
	templateName string
	errTemplate  error
)

// FreshDatabase crée, sur le serveur PostGIS de serverDSN, une base propre au test et la supprime à
// sa fin. migrated : clone d'un gabarit migré une fois par processus (CREATE DATABASE … TEMPLATE,
// rapide) ; sinon base vide (extensions comprises : celles du gabarit template1).
func FreshDatabase(t testing.TB, serverDSN string, migrated bool) string {
	t.Helper()
	ctx := t.Context()
	source := "template1"
	if migrated {
		templateOnce.Do(func() { templateName, errTemplate = migratedTemplate(serverDSN) })
		if errTemplate != nil {
			t.Fatal(errTemplate)
		}
		source = templateName
	}
	name := "t_" + randomHex(6)
	admin, err := pgx.Connect(ctx, withDatabase(serverDSN, "postgres"))
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	defer func() { _ = admin.Close(context.WithoutCancel(ctx)) }()
	if _, err := admin.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %s TEMPLATE %s`, name, source)); err != nil {
		t.Fatalf("create database %s: %v", name, err)
	}
	t.Cleanup(func() {
		c, err := pgx.Connect(context.Background(), withDatabase(serverDSN, "postgres"))
		if err != nil {
			return
		}
		defer func() { _ = c.Close(context.Background()) }()
		_, _ = c.Exec(context.Background(), fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, name))
	})
	return withDatabase(serverDSN, name)
}

// migratedTemplate crée et migre la base gabarit du processus. Aucune connexion n'y reste ouverte
// (condition de CREATE DATABASE … TEMPLATE).
func migratedTemplate(serverDSN string) (string, error) {
	ctx := context.Background()
	name := "tmpl_" + randomHex(6)
	admin, err := pgx.Connect(ctx, withDatabase(serverDSN, "postgres"))
	if err != nil {
		return "", fmt.Errorf("connect postgres: %w", err)
	}
	defer func() { _ = admin.Close(ctx) }()
	if _, err := admin.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %s`, name)); err != nil {
		return "", fmt.Errorf("create template %s: %w", name, err)
	}
	if err := MigrateUp(ctx, withDatabase(serverDSN, name)); err != nil {
		return "", err
	}
	return name, nil
}

// withDatabase remplace le nom de la base dans un DSN postgres://.
func withDatabase(dsn, name string) string {
	u, err := url.Parse(dsn)
	if err != nil {
		return dsn
	}
	u.Path = "/" + strings.TrimPrefix(name, "/")
	return u.String()
}
