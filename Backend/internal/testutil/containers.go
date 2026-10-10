//go:build integration

// Package testutil démarre les dépendances des tests d'intégration avec testcontainers-go,
// sur les mêmes images que docker-compose.yml (POSTGIS_IMAGE et REDIS_IMAGE, passées par
// `make test` depuis .env ; valeurs par défaut identiques à .env.example).
package testutil

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // driver database/sql « pgx », requis par goose
	"github.com/pressly/goose/v3"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"

	"gostation/backend/db"
	"gostation/backend/internal/platform/postgres"
)

// Images par défaut, alignées sur .env.example.
const (
	DefaultPostGISImage = "postgis/postgis:18-3.6"
	DefaultRedisImage   = "redis:8.10.2-alpine"
)

func image(envKey, def string) string {
	if v := os.Getenv(envKey); v != "" {
		return v
	}
	return def
}

// StartPostgres démarre un PostGIS jetable et renvoie son DSN et sa fonction d'arrêt.
func StartPostgres(ctx context.Context) (dsn string, stop func(), err error) {
	ctr, err := tcpostgres.Run(ctx, image("POSTGIS_IMAGE", DefaultPostGISImage),
		tcpostgres.WithDatabase("gostation_test"),
		tcpostgres.WithUsername("gostation"),
		tcpostgres.WithPassword("gostation"),
		tcpostgres.BasicWaitStrategies(),
	)
	stop = func() { _ = testcontainers.TerminateContainer(ctr) }
	if err != nil {
		stop()
		return "", nil, fmt.Errorf("start postgis container: %w", err)
	}
	dsn, err = ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		stop()
		return "", nil, fmt.Errorf("postgis connection string: %w", err)
	}
	return dsn, stop, nil
}

// StartRedis démarre un Redis jetable et renvoie son URL et sa fonction d'arrêt.
func StartRedis(ctx context.Context) (url string, stop func(), err error) {
	ctr, err := tcredis.Run(ctx, image("REDIS_IMAGE", DefaultRedisImage))
	stop = func() { _ = testcontainers.TerminateContainer(ctr) }
	if err != nil {
		stop()
		return "", nil, fmt.Errorf("start redis container: %w", err)
	}
	url, err = ctr.ConnectionString(ctx)
	if err != nil {
		stop()
		return "", nil, fmt.Errorf("redis connection string: %w", err)
	}
	return url, stop, nil
}

// NewMigrator renvoie un provider goose sur les migrations embarquées (db.Migrations).
// L'appelant ferme le *sql.DB.
func NewMigrator(dsn string) (*goose.Provider, *sql.DB, error) {
	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, nil, fmt.Errorf("open database: %w", err)
	}
	migrations, err := fs.Sub(db.Migrations, "migrations")
	if err != nil {
		_ = sqlDB.Close()
		return nil, nil, fmt.Errorf("migrations fs: %w", err)
	}
	p, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations)
	if err != nil {
		_ = sqlDB.Close()
		return nil, nil, fmt.Errorf("goose provider: %w", err)
	}
	return p, sqlDB, nil
}

// MigrateUp applique toutes les migrations.
func MigrateUp(ctx context.Context, dsn string) error {
	p, sqlDB, err := NewMigrator(dsn)
	if err != nil {
		return err
	}
	defer func() { _ = sqlDB.Close() }()
	if _, err := p.Up(ctx); err != nil {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}

// StartMigratedPostgres démarre PostGIS, applique les migrations et ouvre un pool pgx.
func StartMigratedPostgres(ctx context.Context) (pool *pgxpool.Pool, dsn string, stop func(), err error) {
	dsn, stopContainer, err := StartPostgres(ctx)
	if err != nil {
		return nil, "", nil, err
	}
	if err := MigrateUp(ctx, dsn); err != nil {
		stopContainer()
		return nil, "", nil, err
	}
	// Même pool que l'API (sessions et lecture des dates en UTC).
	pool, err = postgres.Connect(ctx, postgres.Options{URL: dsn, AppName: "gostation-tests"})
	if err != nil {
		stopContainer()
		return nil, "", nil, fmt.Errorf("open pool: %w", err)
	}
	return pool, dsn, func() { pool.Close(); stopContainer() }, nil
}
