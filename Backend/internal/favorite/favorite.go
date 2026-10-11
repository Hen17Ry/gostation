// Package favorite gère les stations favorites des comptes vérifiés (20 au plus) et l'alerte
// facultative « de retour en stock » par produit d'un favori.
//
// L'alerte part quand la quantité d'un produit passe de 0 à plus de 0 (station.UpdateStocks →
// tâche favorites:back_in_stock). Limites par utilisateur : 1 alerte par station et par produit
// toutes les 6 h, 5 par jour (journée locale), aucun envoi entre 21 h et 7 h (heure de
// Porto-Novo) : l'alerte attend alors en « pending » et part à 7 h (tâche favorites:release) si
// le stock est toujours positif. Pas d'alerte de réouverture.
package favorite

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/notification"
	"gostation/backend/internal/station"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// CodeLimitReached : plus de 20 favoris (docs/ARCHITECTURE.md §5).
const CodeLimitReached = "favorite.limit_reached"

// Règles (spécification de l'étape 6).
const (
	MaxFavorites  = 20
	AlertCooldown = 6 * time.Hour // par utilisateur, station et produit
	AlertsPerDay  = 5             // par utilisateur, journée locale
	QuietFrom     = 21            // heures calmes : de 21 h…
	QuietUntil    = 7             // … à 7 h (heure locale)
)

// Notifier écrit les notifications et met leurs push en file (*notification.Service).
type Notifier interface {
	Create(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, t notification.Type, data map[string]any) (uuid.UUID, bool, error)
	Dispatch(ctx context.Context, ids []uuid.UUID)
}

// Config regroupe les réglages.
type Config struct {
	Timezone *time.Location
}

// Deps regroupe les dépendances injectées.
type Deps struct {
	Store    *store.Store
	Notifier Notifier
	Log      *slog.Logger
	// Clock donne l'heure courante (horloge réglable dans les tests d'intégration).
	Clock func() time.Time
}

// Service expose les favoris.
type Service struct {
	Deps
	cfg Config
}

// NewService construit le service.
func NewService(cfg Config, d Deps) *Service {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	return &Service{Deps: d, cfg: cfg}
}

// Quiet indique si t tombe dans les heures calmes (21 h – 7 h, heure locale).
func Quiet(t time.Time, loc *time.Location) bool {
	h := t.In(loc).Hour()
	return h >= QuietFrom || h < QuietUntil
}

// Favorite est une station favorite.
type Favorite struct {
	StationID       uuid.UUID
	Name            string
	Brand           *string
	Address         string
	City            *string
	Lat, Lng        *float64
	Available       bool // station approuvée (visible dans la recherche et sa fiche)
	AlertProductIDs []int16
	CreatedAt       time.Time
}

func toFavorite(r dbgen.ListFavoritesRow) Favorite {
	alerts := r.AlertProductIds
	if alerts == nil {
		alerts = []int16{}
	}
	return Favorite{
		StationID: r.StationID, Name: r.Name, Brand: r.Brand, Address: r.Address, City: r.City,
		Lat: r.Lat, Lng: r.Lng, Available: r.Available, AlertProductIDs: alerts, CreatedAt: r.CreatedAt,
	}
}

// List renvoie les favoris, le plus récent d'abord.
func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]Favorite, error) {
	rows, err := s.Store.ListFavorites(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("favorite: list: %w", err)
	}
	out := make([]Favorite, 0, len(rows))
	for _, r := range rows {
		out = append(out, toFavorite(r))
	}
	return out, nil
}

// Add ajoute une station approuvée aux favoris (idempotent). alerts, s'il est fourni, remplace la
// liste des produits suivis pour l'alerte « de retour en stock ». created vaut false si la
// station était déjà en favori.
func (s *Service) Add(ctx context.Context, userID, stationID uuid.UUID, alerts *[]int16) (Favorite, bool, error) {
	if alerts != nil {
		if err := s.checkProducts(ctx, *alerts); err != nil {
			return Favorite{}, false, err
		}
	}
	if _, err := s.Store.GetPublicStation(ctx, stationID); err != nil {
		return Favorite{}, false, fmt.Errorf("favorite: load station: %w", store.Translate(err))
	}
	created := false
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.AdvisoryLock(ctx, "favorites:"+userID.String()); err != nil {
			return err
		}
		n, err := q.InsertFavorite(ctx, dbgen.InsertFavoriteParams{UserID: userID, StationID: stationID})
		if err != nil {
			return err
		}
		if created = n == 1; created {
			count, err := q.CountFavorites(ctx, userID)
			if err != nil {
				return err
			}
			if count > MaxFavorites {
				return apperr.New(http.StatusConflict, CodeLimitReached, fmt.Sprintf("You can keep at most %d favorite stations.", MaxFavorites))
			}
		}
		if alerts == nil {
			return nil
		}
		if err := q.DeleteFavoriteAlerts(ctx, dbgen.DeleteFavoriteAlertsParams{UserID: userID, StationID: stationID}); err != nil {
			return err
		}
		if len(*alerts) == 0 {
			return nil
		}
		return q.InsertFavoriteAlerts(ctx, dbgen.InsertFavoriteAlertsParams{UserID: userID, StationID: stationID, ProductIds: *alerts})
	})
	if err != nil {
		return Favorite{}, false, fmt.Errorf("favorite: add: %w", err)
	}
	favs, err := s.List(ctx, userID)
	if err != nil {
		return Favorite{}, false, err
	}
	for _, f := range favs {
		if f.StationID == stationID {
			return f, created, nil
		}
	}
	return Favorite{}, false, apperr.NotFound("Favorite not found.")
}

func (s *Service) checkProducts(ctx context.Context, ids []int16) error {
	catalog, err := s.Store.ListActiveProducts(ctx)
	if err != nil {
		return fmt.Errorf("favorite: catalog: %w", err)
	}
	var f []apperr.FieldError
	seen := map[int16]bool{}
	for i, id := range ids {
		field := fmt.Sprintf("alertProductIds[%d]", i)
		known := slices.ContainsFunc(catalog, func(p dbgen.ListActiveProductsRow) bool { return p.ID == id })
		switch {
		case seen[id]:
			f = append(f, apperr.FieldError{Field: field, Code: "duplicate", Message: "each product must appear once"})
		case !known:
			f = append(f, apperr.FieldError{Field: field, Code: "unknown_product", Message: "is not an active product"})
		}
		seen[id] = true
	}
	if len(f) > 0 {
		return apperr.Validation(f...)
	}
	return nil
}

// Remove retire une station des favoris (idempotent), avec ses alertes.
func (s *Service) Remove(ctx context.Context, userID, stationID uuid.UUID) error {
	if _, err := s.Store.DeleteFavorite(ctx, dbgen.DeleteFavoriteParams{UserID: userID, StationID: stationID}); err != nil {
		return fmt.Errorf("favorite: remove: %w", err)
	}
	return nil
}

// ── Alertes « de retour en stock » (worker) ─────────────────────────────────

// BackInStock traite le passage de produits de 0 à plus de 0 dans une station : une alerte par
// abonné, dans les limites (6 h, 5 par jour), ou en attente pendant les heures calmes.
func (s *Service) BackInStock(ctx context.Context, stationID uuid.UUID, productIDs []int16) error {
	now := s.Clock()
	var ids []uuid.UUID
	defer func() { s.Notifier.Dispatch(context.WithoutCancel(ctx), ids) }()
	for _, productID := range productIDs {
		info, err := s.Store.GetBackInStockContext(ctx, dbgen.GetBackInStockContextParams{StationID: stationID, ProductID: productID})
		if store.IsNotFound(err) {
			continue
		}
		if err != nil {
			return fmt.Errorf("favorite: load context: %w", err)
		}
		if !info.Approved || info.Quantity <= 0 {
			continue // repassé à 0 ou station retirée entre-temps
		}
		users, err := s.Store.ListBackInStockSubscribers(ctx, dbgen.ListBackInStockSubscribersParams{StationID: stationID, ProductID: productID})
		if err != nil {
			return fmt.Errorf("favorite: list subscribers: %w", err)
		}
		for _, userID := range users {
			id, err := s.alert(ctx, userID, stationID, productID, info, now)
			if err != nil {
				return err
			}
			if id != uuid.Nil {
				ids = append(ids, id)
			}
		}
	}
	return nil
}

func alertData(stationID uuid.UUID, productID int16, info dbgen.GetBackInStockContextRow) map[string]any {
	return map[string]any{
		"stationId": stationID.String(), "stationName": info.StationName,
		"productId": productID, "productLabel": info.ProductLabel,
	}
}

// alert applique les limites d'un abonné et envoie (ou met en attente) son alerte. Renvoie
// l'identifiant de la notification créée, uuid.Nil sinon.
func (s *Service) alert(ctx context.Context, userID, stationID uuid.UUID, productID int16, info dbgen.GetBackInStockContextRow, now time.Time) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.AdvisoryLock(ctx, "back-in-stock:"+userID.String()); err != nil {
			return err
		}
		pending, err := q.HasPendingBackInStock(ctx, dbgen.HasPendingBackInStockParams{UserID: userID, StationID: stationID, ProductID: productID})
		if err != nil || pending {
			return err
		}
		recent, err := q.CountBackInStockSentSince(ctx, dbgen.CountBackInStockSentSinceParams{
			UserID: userID, StationID: stationID, ProductID: productID, Since: now.Add(-AlertCooldown),
		})
		if err != nil || recent > 0 {
			return err
		}
		if Quiet(now, s.cfg.Timezone) {
			return q.InsertBackInStockAlert(ctx, dbgen.InsertBackInStockAlertParams{
				UserID: userID, StationID: stationID, ProductID: productID, Status: dbgen.BackInStockStatusPending, CreatedAt: now,
			})
		}
		ok, err := s.underDailyCap(ctx, q, userID, now)
		if err != nil || !ok {
			return err
		}
		nid, created, err := s.Notifier.Create(ctx, q, userID, notification.TypeBackInStock, alertData(stationID, productID, info))
		if err != nil || !created {
			return err
		}
		id = nid
		return q.InsertBackInStockAlert(ctx, dbgen.InsertBackInStockAlertParams{
			UserID: userID, StationID: stationID, ProductID: productID, Status: dbgen.BackInStockStatusSent, CreatedAt: now, SentAt: &now,
		})
	})
	if err != nil {
		return uuid.Nil, fmt.Errorf("favorite: back-in-stock alert: %w", err)
	}
	return id, nil
}

func (s *Service) underDailyCap(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, now time.Time) (bool, error) {
	n, err := q.CountUserBackInStockSentSince(ctx, dbgen.CountUserBackInStockSentSinceParams{
		UserID: userID, Since: station.DayStart(now, s.cfg.Timezone),
	})
	return n < AlertsPerDay, err
}

// ReleasePending envoie, hors heures calmes, les alertes mises en attente la nuit si le stock est
// toujours positif (tâche favorites:release, toutes les 15 min : la première passe à 7 h).
// Les alertes qui ne peuvent plus partir (stock à 0, limites atteintes) sont abandonnées.
func (s *Service) ReleasePending(ctx context.Context) (int, error) {
	now := s.Clock()
	if Quiet(now, s.cfg.Timezone) {
		return 0, nil
	}
	rows, err := s.Store.ListPendingBackInStock(ctx)
	if err != nil {
		return 0, fmt.Errorf("favorite: list pending alerts: %w", err)
	}
	var ids []uuid.UUID
	defer func() { s.Notifier.Dispatch(context.WithoutCancel(ctx), ids) }()
	for _, r := range rows {
		var id uuid.UUID
		err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
			if err := q.AdvisoryLock(ctx, "back-in-stock:"+r.UserID.String()); err != nil {
				return err
			}
			status, sentAt := dbgen.BackInStockStatusDropped, (*time.Time)(nil)
			info, err := q.GetBackInStockContext(ctx, dbgen.GetBackInStockContextParams{StationID: r.StationID, ProductID: r.ProductID})
			if err != nil && !store.IsNotFound(err) {
				return err
			}
			if err == nil && info.Approved && info.Quantity > 0 {
				recent, err := q.CountBackInStockSentSince(ctx, dbgen.CountBackInStockSentSinceParams{
					UserID: r.UserID, StationID: r.StationID, ProductID: r.ProductID, Since: now.Add(-AlertCooldown),
				})
				if err != nil {
					return err
				}
				ok, err := s.underDailyCap(ctx, q, r.UserID, now)
				if err != nil {
					return err
				}
				if recent == 0 && ok {
					nid, created, err := s.Notifier.Create(ctx, q, r.UserID, notification.TypeBackInStock, alertData(r.StationID, r.ProductID, info))
					if err != nil {
						return err
					}
					if created {
						id, status, sentAt = nid, dbgen.BackInStockStatusSent, &now
					}
				}
			}
			return q.SetBackInStockStatus(ctx, dbgen.SetBackInStockStatusParams{ID: r.ID, Status: status, SentAt: sentAt})
		})
		if err != nil {
			return len(ids), fmt.Errorf("favorite: release alert: %w", err)
		}
		if id != uuid.Nil {
			ids = append(ids, id)
		}
	}
	return len(ids), nil
}
