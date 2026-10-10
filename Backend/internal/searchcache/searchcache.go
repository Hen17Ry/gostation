// Package searchcache gère les générations du cache de recherche (ARCHITECTURE §4.2).
//
// La clé d'un résultat inclut deux générations : celle du produit (search:gen:p{id}) et une
// génération globale (search:gen:all). Les incrémenter rend instantanément inaccessibles les
// résultats en cache, qui expirent ensuite par TTL. On ne supprime jamais de clés par motif :
// une station qui redevient disponible doit apparaître dans des cellules dont le cache ne la
// contient pas encore.
package searchcache

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	goredis "github.com/redis/go-redis/v9"
)

const (
	globalKey     = "search:gen:all"
	productPrefix = "search:gen:p"
)

// Generations est le couple de générations qui entre dans une clé de cache.
type Generations struct {
	All     int64
	Product int64
}

// Invalidator incrémente et lit les générations.
type Invalidator struct {
	rdb goredis.UniversalClient
}

// New construit l'invalidateur.
func New(rdb goredis.UniversalClient) *Invalidator { return &Invalidator{rdb: rdb} }

func productKey(id int16) string { return productPrefix + strconv.Itoa(int(id)) }

// Products invalide les résultats des produits donnés (mise à jour de stock).
func (i *Invalidator) Products(ctx context.Context, ids ...int16) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := i.rdb.Pipelined(ctx, func(p goredis.Pipeliner) error {
		for _, id := range ids {
			p.Incr(ctx, productKey(id))
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("searchcache: invalidate products: %w", err)
	}
	return nil
}

// All invalide tous les résultats (statut, position, horaires, fermetures, produits vendus).
func (i *Invalidator) All(ctx context.Context) error {
	if err := i.rdb.Incr(ctx, globalKey).Err(); err != nil {
		return fmt.Errorf("searchcache: invalidate all: %w", err)
	}
	return nil
}

// Current lit les générations d'un produit (0 si jamais incrémentées).
func (i *Invalidator) Current(ctx context.Context, productID int16) (Generations, error) {
	vals, err := i.rdb.MGet(ctx, globalKey, productKey(productID)).Result()
	if err != nil {
		return Generations{}, fmt.Errorf("searchcache: read generations: %w", err)
	}
	parse := func(v any) (int64, error) {
		s, ok := v.(string)
		if !ok || s == "" {
			return 0, nil
		}
		return strconv.ParseInt(s, 10, 64)
	}
	all, err1 := parse(vals[0])
	prod, err2 := parse(vals[1])
	if err := errors.Join(err1, err2); err != nil {
		return Generations{}, fmt.Errorf("searchcache: corrupt generation: %w", err)
	}
	return Generations{All: all, Product: prod}, nil
}

// Key construit la clé d'un résultat en cache (utilisée par la recherche, étape 5).
func Key(productID int16, g Generations, cell string) string {
	return fmt.Sprintf("search:v1:p%d:g%d.%d:c%s", productID, g.All, g.Product, cell)
}
