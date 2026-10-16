// Commande devtools : déclenche les notifications sans attendre, pour les tester sur un vrai
// téléphone (make dev-remind, make dev-notify, make dev-decide). Refuse de tourner hors
// APP_ENV=development.
//
// Les push partent par le worker (file asynq) : il doit tourner (make api-up ou make worker-run).
// Les heures calmes et les plafonds se testent par les tests d'intégration, à horloge injectée.
//
// Usage :
//
//	devtools remind -station <uuid> [-reset]
//	devtools notify -type <stock_reminder|back_in_stock|station_reported|station_decision> -user <email|uuid>
//	                [-station <uuid>] [-decision approved|rejected|suspended|reinstated|move_approved|move_rejected]
//	devtools decide -station <uuid> -action <approve|reject|suspend|unsuspend> [-reason …]
//
// decide prend la décision par le service des stations, comme l'admin web (audit, email, push de
// décision), au nom du premier admin actif de la base.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"gostation/backend/internal/app"
	"gostation/backend/internal/config"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/notification"
	"gostation/backend/internal/platform/postgres"
	"gostation/backend/internal/platform/redis"
	"gostation/backend/internal/searchcache"
	"gostation/backend/internal/station"
	"gostation/backend/internal/store/dbgen"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "devtools:", err)
		os.Exit(1)
	}
}

const usage = "usage: devtools remind -station <uuid> [-reset] | devtools notify -type <type> -user <email|uuid> [-station <uuid>] [-decision …] | devtools decide -station <uuid> -action <approve|reject|suspend|unsuspend> [-reason …]"

func run(args []string) error {
	if len(args) == 0 {
		return errors.New(usage)
	}
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	if cfg.Env != config.EnvDevelopment {
		return fmt.Errorf("refused: APP_ENV=%s (development only)", cfg.Env)
	}
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	pool, err := postgres.Connect(ctx, postgres.Options{URL: cfg.Postgres.URL, MaxConns: 4, AppName: "gostation-devtools"})
	if err != nil {
		return err
	}
	defer pool.Close()
	rdb, err := redis.Connect(ctx, cfg.Redis.URL)
	if err != nil {
		return err
	}
	defer func() { _ = rdb.Close() }()
	svc, err := app.NewServices(cfg, app.Infra{Pool: pool, Redis: rdb, Mailer: discardMailer{}}, log)
	if err != nil {
		return err
	}
	switch args[0] {
	case "remind":
		fs := flag.NewFlagSet("remind", flag.ContinueOnError)
		stationArg := fs.String("station", "", "station (uuid)")
		reset := fs.Bool("reset", false, "remet à zéro les compteurs du jour (plafond de 4 et arrêt), pas la série d'ignorés")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		id, err := uuid.Parse(*stationArg)
		if err != nil {
			return errors.New("-station must be a station uuid")
		}
		return remind(ctx, pool, rdb, svc, cfg, id, *reset)
	case "notify":
		fs := flag.NewFlagSet("notify", flag.ContinueOnError)
		typ := fs.String("type", "", "stock_reminder | back_in_stock | station_reported | station_decision")
		user := fs.String("user", "", "compte destinataire (email ou uuid)")
		stationArg := fs.String("station", "", "station (back_in_stock : favori ou station approuvée à défaut)")
		decision := fs.String("decision", notification.DecisionApproved, "décision (station_decision)")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		return notify(ctx, pool, svc, notification.Type(*typ), *user, *stationArg, *decision)
	case "decide":
		fs := flag.NewFlagSet("decide", flag.ContinueOnError)
		stationArg := fs.String("station", "", "station (uuid)")
		action := fs.String("action", "approve", "approve | reject | suspend | unsuspend")
		reason := fs.String("reason", "", "motif (exigé pour reject, suspend et unsuspend)")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		id, err := uuid.Parse(*stationArg)
		if err != nil {
			return errors.New("-station must be a station uuid")
		}
		return decide(ctx, pool, svc, id, *action, *reason)
	default:
		return errors.New(usage)
	}
}

// remind vieillit la dernière mise à jour (et le dernier rappel) de la station au-delà du délai
// des rappels, puis lance un passage de la tâche de rappel, comme le scheduler toutes les 15 min.
func remind(ctx context.Context, pool *pgxpool.Pool, rdb *goredis.Client, svc *app.Services, cfg config.Config, id uuid.UUID, reset bool) error {
	var status string
	var manager *uuid.UUID
	err := pool.QueryRow(ctx, `SELECT status, manager_id FROM stations WHERE id = $1`, id).Scan(&status, &manager)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("no station with this id")
	}
	if err != nil {
		return err
	}
	if status != "approved" || manager == nil {
		return fmt.Errorf("the station must be approved and have a manager (status %s)", status)
	}
	aged := time.Now().Add(-cfg.Reminders.Interval - time.Minute)
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	for _, q := range []string{
		`UPDATE station_stocks SET updated_at = LEAST(updated_at, $2), last_confirmed_at = LEAST(last_confirmed_at, $2) WHERE station_id = $1`,
		`UPDATE stations SET last_stock_update_at = LEAST(last_stock_update_at, $2) WHERE id = $1`,
		`UPDATE station_reminders SET last_sent_at = LEAST(last_sent_at, $2), muted_until = NULL WHERE station_id = $1`,
	} {
		if _, err := tx.Exec(ctx, q, id, aged); err != nil {
			return err
		}
	}
	if reset {
		if _, err := tx.Exec(ctx, `UPDATE station_reminders SET sent = 0, stopped = false WHERE station_id = $1`, id); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	_ = searchcache.New(rdb).All(ctx)
	res, err := svc.Reminders.Scan(ctx)
	if err != nil {
		return err
	}
	var sent, streak int
	_ = pool.QueryRow(ctx, `SELECT sent, streak FROM station_reminders WHERE station_id = $1`, id).Scan(&sent, &streak)
	fmt.Printf("reminders scan: %d sent, %d escalated (all stations); this station: %d today, %d ignored in a row\n", res.Sent, res.Escalated, sent, streak)
	if res.Sent == 0 && res.Escalated == 0 {
		fmt.Println("nothing sent: is the station open now, below 4 reminders today (-reset), with stocks and reminders not opted out?")
	}
	return nil
}

// notify écrit une notification du type demandé dans la boîte de réception du compte et met son
// push en file, avec des données plausibles tirées de la base.
func notify(ctx context.Context, pool *pgxpool.Pool, svc *app.Services, typ notification.Type, user, stationArg, decision string) error {
	var userID uuid.UUID
	if id, err := uuid.Parse(user); err == nil {
		userID = id
	} else if err := pool.QueryRow(ctx, `SELECT id FROM users WHERE email = lower($1)`, strings.TrimSpace(user)).Scan(&userID); err != nil {
		return errors.New("no account with this email")
	}
	data := map[string]any{}
	switch typ {
	case notification.TypeStockReminder, notification.TypeStationReported, notification.TypeStationDecision:
		var id uuid.UUID
		var name string
		var version int32
		var last *time.Time
		err := pool.QueryRow(ctx, `SELECT id, name, version, last_stock_update_at FROM stations WHERE manager_id = $1`, userID).Scan(&id, &name, &version, &last)
		if err != nil {
			return errors.New("this account manages no station")
		}
		data["stationId"], data["stationName"] = id.String(), name
		switch typ {
		case notification.TypeStockReminder:
			data["etag"] = station.ETag(version)
			if last != nil {
				data["hoursSinceUpdate"] = int(time.Since(*last).Hours())
			}
		case notification.TypeStationReported:
			data["level"], data["reason"], data["reporters"] = notification.LevelFlagged, "out_of_stock", 3
			if err := addProduct(ctx, pool, data, id); err != nil {
				return err
			}
		default:
			data["decision"] = decision
		}
	case notification.TypeBackInStock:
		id, err := uuid.Parse(stationArg)
		if err != nil {
			err = pool.QueryRow(ctx, `SELECT s.id FROM favorites f JOIN stations s ON s.id = f.station_id
				WHERE f.user_id = $1 AND s.status = 'approved' ORDER BY f.created_at LIMIT 1`, userID).Scan(&id)
		}
		if err != nil {
			err = pool.QueryRow(ctx, `SELECT id FROM stations WHERE status = 'approved' AND NOT is_demo ORDER BY created_at LIMIT 1`).Scan(&id)
		}
		if err != nil {
			return errors.New("no approved station: pass -station <uuid>")
		}
		var name string
		if err := pool.QueryRow(ctx, `SELECT name FROM stations WHERE id = $1`, id).Scan(&name); err != nil {
			return err
		}
		data["stationId"], data["stationName"] = id.String(), name
		if err := addProduct(ctx, pool, data, id); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unknown type %q", typ)
	}
	var id uuid.UUID
	var created bool
	err := svc.Store.InTx(ctx, func(q *dbgen.Queries) error {
		var err error
		id, created, err = svc.Notifications.Create(ctx, q, userID, typ, data)
		return err
	})
	if err != nil {
		return err
	}
	if !created {
		return errors.New("not created: this type is turned off in the account's preferences, or the account is inactive")
	}
	svc.Notifications.Dispatch(ctx, []uuid.UUID{id})
	fmt.Printf("%s queued (notification %s): the worker sends the push\n", typ, id)
	return nil
}

// addProduct ajoute un produit vendu par la station (le premier en stock, à défaut le premier).
func addProduct(ctx context.Context, pool *pgxpool.Pool, data map[string]any, stationID uuid.UUID) error {
	var id int16
	var label string
	err := pool.QueryRow(ctx, `SELECT p.id, p.label_fr FROM station_stocks ss JOIN products p ON p.id = ss.product_id
		WHERE ss.station_id = $1 ORDER BY ss.quantity > 0 DESC, p.sort_order LIMIT 1`, stationID).Scan(&id, &label)
	if err != nil {
		err = pool.QueryRow(ctx, `SELECT id, label_fr FROM products WHERE is_active ORDER BY sort_order LIMIT 1`).Scan(&id, &label)
	}
	if err != nil {
		return errors.New("no product in the catalogue")
	}
	data["productId"], data["productLabel"] = id, label
	return nil
}

// discardMailer : les emails passent par la file du worker (mail.Queue), jamais par ce processus.
type discardMailer struct{}

func (discardMailer) Send(context.Context, mail.Message) error { return nil }

// decide applique une décision d'admin à la station, au nom du premier admin actif.
func decide(ctx context.Context, pool *pgxpool.Pool, svc *app.Services, id uuid.UUID, action, reason string) error {
	var adminID uuid.UUID
	err := pool.QueryRow(ctx, `SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1`).Scan(&adminID)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("no active admin (make admin-create)")
	}
	if err != nil {
		return err
	}
	st, err := svc.Station.AdminDetail(ctx, id)
	if err != nil {
		return err
	}
	after, err := svc.Station.ChangeStatus(ctx, station.Actor{UserID: adminID, Role: "admin"}, id, st.Version, action, reason)
	if err != nil {
		return err
	}
	fmt.Printf("station %s: %s -> %s (le worker envoie le push)\n", id, st.Status, after.Status)
	return nil
}
