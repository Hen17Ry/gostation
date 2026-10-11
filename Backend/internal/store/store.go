// Package store regroupe l'accès aux données : les requêtes générées par sqlc (sous-paquet
// dbgen, à ne jamais éditer), les transactions et la traduction des erreurs PostgreSQL.
package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/store/dbgen"
)

// Store expose toutes les requêtes sqlc (via *dbgen.Queries) et les transactions.
type Store struct {
	*dbgen.Queries
	pool *pgxpool.Pool
}

// New construit le store sur un pool pgx.
func New(pool *pgxpool.Pool) *Store {
	return &Store{Queries: dbgen.New(pool), pool: pool}
}

// InTx exécute fn dans une transaction : commit si fn renvoie nil, rollback sinon
// (y compris en cas de panic). Toutes les requêtes passées par q appartiennent à la transaction.
func (s *Store) InTx(ctx context.Context, fn func(q *dbgen.Queries) error) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		return fn(s.WithTx(tx)) // dbgen.Queries.WithTx (champ embarqué)
	})
}

// Ping vérifie la connexion à PostgreSQL (sonde /readyz).
func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

// Codes SQLSTATE traduits par Translate.
const (
	sqlStateUniqueViolation     = "23505"
	sqlStateForeignKeyViolation = "23503"
)

// Translate convertit les erreurs pgx en erreurs applicatives : aucune ligne → 404,
// violation d'unicité ou de clé étrangère → 409. Les autres erreurs sont renvoyées telles
// quelles (→ 500). Les domaines affinent le code d'après ConstraintName (ex. auth.email_taken).
func Translate(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.NotFound("Resource not found.").Wrap(err)
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case sqlStateUniqueViolation:
			return apperr.Conflict("Resource already exists.").Wrap(err)
		case sqlStateForeignKeyViolation:
			return apperr.Conflict("Referenced resource does not exist or is still in use.").Wrap(err)
		}
	}
	return err
}

// IsNotFound indique qu'une requête :one n'a renvoyé aucune ligne.
func IsNotFound(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// ConstraintName renvoie le nom de la contrainte violée, ou "".
func ConstraintName(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.ConstraintName
	}
	return ""
}

// Unprepared renvoie les requêtes sqlc exécutées sans plan mis en cache (instruction préparée
// anonyme, mode pgx QueryExecModeExec) : PostgreSQL planifie alors chaque exécution avec les
// valeurs réelles des paramètres. Réservé aux agrégats sur des plages de dates (stats admin), où le
// plan générique d'une instruction préparée sous-estime les lignes d'un facteur 1 000 et choisit un
// tri au lieu d'un hachage parallèle (×2 à ×5 sur 30 jours de stats).
func (s *Store) Unprepared() *dbgen.Queries { return dbgen.New(unprepared{s.pool}) }

type unprepared struct{ pool *pgxpool.Pool }

func execMode(args []any) []any { return append([]any{pgx.QueryExecModeExec}, args...) }

func (u unprepared) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return u.pool.Exec(ctx, sql, execMode(args)...)
}

func (u unprepared) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return u.pool.Query(ctx, sql, execMode(args)...)
}

func (u unprepared) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return u.pool.QueryRow(ctx, sql, execMode(args)...)
}

func (u unprepared) CopyFrom(ctx context.Context, table pgx.Identifier, columns []string, src pgx.CopyFromSource) (int64, error) {
	return u.pool.CopyFrom(ctx, table, columns, src)
}
