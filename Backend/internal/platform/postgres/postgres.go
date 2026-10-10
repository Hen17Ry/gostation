// Package postgres ouvre le pool de connexions pgx vers PostgreSQL/PostGIS.
package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Options configure le pool.
type Options struct {
	URL      string
	MaxConns int32
	// AppName apparaît dans pg_stat_activity.
	AppName string
}

// Connect ouvre le pool et vérifie la connexion (échec explicite au démarrage).
// Les sessions sont en UTC : les horodatages sont convertis côté application.
func Connect(ctx context.Context, opts Options) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(opts.URL)
	if err != nil {
		return nil, fmt.Errorf("postgres: parse DATABASE_URL: %w", err)
	}
	if opts.MaxConns > 0 {
		cfg.MaxConns = opts.MaxConns
	}
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second
	if opts.AppName != "" {
		cfg.ConnConfig.RuntimeParams["application_name"] = opts.AppName
	}
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	// pgx convertit les timestamptz dans le fuseau local du processus : on impose UTC pour que
	// l'API renvoie toujours des dates RFC 3339 en UTC, quel que soit le fuseau de la machine.
	cfg.AfterConnect = func(_ context.Context, conn *pgx.Conn) error {
		conn.TypeMap().RegisterType(&pgtype.Type{
			Name: "timestamptz", OID: pgtype.TimestamptzOID,
			Codec: &pgtype.TimestamptzCodec{ScanLocation: time.UTC},
		})
		return nil
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("postgres: create pool: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("postgres: ping: %w", err)
	}
	return pool, nil
}
