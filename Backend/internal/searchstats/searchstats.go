// Package searchstats compte les recherches de façon anonyme (D23) : cellule H3 res 7, produit,
// tranche horaire, nombre de recherches et nombre de recherches sans station ouverte à moins de
// 5 km (signal de pénurie). Aucun identifiant utilisateur ni position exacte n'est enregistré.
//
// Les compteurs vivent dans Redis (stats:search:{heure} → HASH « cellule:produit:s|e ») et sont
// vidés périodiquement dans search_stats. Le vidage renomme d'abord chaque clé (passage de
// relais atomique : les nouvelles recherches repartent sur une clé neuve), sous un verrou Redis
// pour qu'une seule instance vide à la fois. Une tranche dont l'écriture en base échoue reste
// en attente (suffixe :flushing) et repart au vidage suivant, sans perte.
package searchstats

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

const (
	keyPrefix   = "stats:search:"
	flushingTag = ":flushing"
	lockKey     = "stats:search-flush-lock"
	keyTTL      = 72 * time.Hour // filet de sécurité si le vidage s'arrête
)

// Recorder incrémente les compteurs.
type Recorder struct {
	rdb goredis.UniversalClient
	now func() time.Time
}

// NewRecorder construit le compteur.
func NewRecorder(rdb goredis.UniversalClient) *Recorder {
	return &Recorder{rdb: rdb, now: time.Now}
}

func bucketKey(t time.Time) string {
	return keyPrefix + strconv.FormatInt(t.UTC().Truncate(time.Hour).Unix(), 10)
}

// Record compte une recherche. cellR7 est l'index de la cellule H3 res 7 (jamais la position).
func (r *Recorder) Record(ctx context.Context, cellR7 int64, productID int16, emptyWithin5km bool) error {
	key := bucketKey(r.now())
	field := strconv.FormatInt(cellR7, 10) + ":" + strconv.Itoa(int(productID))
	_, err := r.rdb.Pipelined(ctx, func(p goredis.Pipeliner) error {
		p.HIncrBy(ctx, key, field+":s", 1)
		if emptyWithin5km {
			p.HIncrBy(ctx, key, field+":e", 1)
		}
		p.Expire(ctx, key, keyTTL)
		return nil
	})
	if err != nil {
		return fmt.Errorf("searchstats: record: %w", err)
	}
	return nil
}

// Flusher vide les compteurs Redis dans search_stats.
type Flusher struct {
	rdb   goredis.UniversalClient
	store *store.Store
	log   *slog.Logger
}

// NewFlusher construit le vidage.
func NewFlusher(rdb goredis.UniversalClient, st *store.Store, log *slog.Logger) *Flusher {
	return &Flusher{rdb: rdb, store: st, log: log}
}

type counter struct{ searches, empty int32 }

// Flush vide toutes les tranches horaires (en cours comprise) et renvoie le nombre de lignes
// agrégées. Une tranche dont l'écriture en base échoue reste en attente pour le vidage suivant.
func (f *Flusher) Flush(ctx context.Context) (int, error) {
	ok, err := f.rdb.SetNX(ctx, lockKey, "1", time.Minute).Result()
	if err != nil {
		return 0, fmt.Errorf("searchstats: lock: %w", err)
	}
	if !ok {
		return 0, nil // une autre instance vide en ce moment
	}
	defer func() { _ = f.rdb.Del(context.WithoutCancel(ctx), lockKey).Err() }()

	keys, err := f.scan(ctx)
	if err != nil {
		return 0, err
	}
	// Passage de relais : RENAMENX ne remplace jamais une tranche restée en attente après un
	// échec (elle est vidée d'abord ; la clé vivante attend alors le vidage suivant).
	pending := map[string]bool{}
	for _, k := range keys {
		if strings.HasSuffix(k, flushingTag) {
			pending[k] = true
		}
	}
	for _, k := range keys {
		if strings.HasSuffix(k, flushingTag) || pending[k+flushingTag] {
			continue
		}
		renamed, err := f.rdb.RenameNX(ctx, k, k+flushingTag).Result()
		if err != nil {
			if strings.Contains(err.Error(), "no such key") {
				continue
			}
			return 0, fmt.Errorf("searchstats: rename: %w", err)
		}
		if renamed {
			pending[k+flushingTag] = true
		}
	}
	rows := 0
	for k := range pending {
		n, err := f.flushKey(ctx, k)
		if err != nil {
			f.log.WarnContext(ctx, "searchstats: flush bucket failed, will retry", slog.String("key", k), slog.Any("err", err))
			continue
		}
		rows += n
	}
	return rows, nil
}

func (f *Flusher) scan(ctx context.Context) ([]string, error) {
	var keys []string
	iter := f.rdb.Scan(ctx, 0, keyPrefix+"*", 200).Iterator()
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}
	if err := iter.Err(); err != nil {
		return nil, fmt.Errorf("searchstats: scan: %w", err)
	}
	return keys, nil
}

func (f *Flusher) flushKey(ctx context.Context, key string) (int, error) {
	unix, err := strconv.ParseInt(strings.TrimSuffix(strings.TrimPrefix(key, keyPrefix), flushingTag), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("malformed key %q", key)
	}
	bucket := time.Unix(unix, 0).UTC()
	fields, err := f.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	agg := map[[2]int64]*counter{}
	for field, raw := range fields {
		parts := strings.Split(field, ":")
		if len(parts) != 3 {
			continue
		}
		cell, err1 := strconv.ParseInt(parts[0], 10, 64)
		product, err2 := strconv.ParseInt(parts[1], 10, 16)
		n, err3 := strconv.ParseInt(raw, 10, 32)
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		c := agg[[2]int64{cell, product}]
		if c == nil {
			c = &counter{}
			agg[[2]int64{cell, product}] = c
		}
		if parts[2] == "e" {
			c.empty += int32(n) //nolint:gosec // compteurs horaires bornés
		} else {
			c.searches += int32(n) //nolint:gosec // idem
		}
	}
	err = f.store.InTx(ctx, func(q *dbgen.Queries) error {
		for k, c := range agg {
			if err := q.UpsertSearchStats(ctx, dbgen.UpsertSearchStatsParams{
				Bucket: bucket, H3R7: k[0], ProductID: int16(k[1]), //nolint:gosec // id produit smallint
				Searches: c.searches, EmptyWithin5km: c.empty,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	if err := f.rdb.Del(ctx, key).Err(); err != nil {
		return 0, err
	}
	return len(agg), nil
}

// Run vide toutes les interval jusqu'à l'annulation de ctx, puis une dernière fois.
func (f *Flusher) Run(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			final := context.WithoutCancel(ctx)
			if _, err := f.Flush(final); err != nil {
				f.log.WarnContext(final, "searchstats: final flush failed", slog.Any("err", err))
			}
			return
		case <-t.C:
			if _, err := f.Flush(ctx); err != nil {
				f.log.WarnContext(ctx, "searchstats: flush failed", slog.Any("err", err))
			}
		}
	}
}
