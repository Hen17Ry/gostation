package main

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"io/fs"

	_ "github.com/jackc/pgx/v5/stdlib" // driver database/sql « pgx », requis par goose
	"github.com/pressly/goose/v3"

	"gostation/backend/db"
	"gostation/backend/internal/config"
)

// migrate applique les migrations embarquées (db.Migrations) sur DATABASE_URL : en production, la
// base n'est pas exposée, la commande tourne dans un conteneur jetable du réseau interne
// (`scripts/prod.sh migrate`). « migrate status » liste les migrations sans rien appliquer.
func migrate(ctx context.Context, getenv func(string) string, args []string, stdout io.Writer) error {
	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	sqlDB, err := sql.Open("pgx", cfg.Postgres.URL)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() { _ = sqlDB.Close() }()
	migrations, err := fs.Sub(db.Migrations, "migrations")
	if err != nil {
		return fmt.Errorf("migrations fs: %w", err)
	}
	p, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations)
	if err != nil {
		return fmt.Errorf("goose provider: %w", err)
	}
	if len(args) > 0 && args[0] == "status" {
		statuses, err := p.Status(ctx)
		if err != nil {
			return fmt.Errorf("migration status: %w", err)
		}
		for _, s := range statuses {
			fmt.Fprintf(stdout, "%-8s %d %s\n", s.State, s.Source.Version, s.Source.Path)
		}
		return nil
	}
	results, err := p.Up(ctx)
	for _, r := range results {
		fmt.Fprintf(stdout, "applied %d %s (%s)\n", r.Source.Version, r.Source.Path, r.Duration.Round(1e6))
	}
	if err != nil {
		return fmt.Errorf("migrate up: %w", err)
	}
	v, err := p.GetDBVersion(ctx)
	if err != nil {
		return fmt.Errorf("database version: %w", err)
	}
	fmt.Fprintf(stdout, "database at version %d (%d applied now)\n", v, len(results))
	return nil
}
