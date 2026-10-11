package station

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/store/dbgen"
)

// Fraîcheur d'un stock (D16), calculée sur le plus récent de updated_at et last_confirmed_at.
const (
	FreshnessFresh   = "fresh"
	FreshnessStale   = "stale"   // au-delà de STOCK_STALE_AFTER : badge « à vérifier »
	FreshnessExpired = "expired" // au-delà de STOCK_EXPIRED_AFTER : exclu de la recherche
)

// Freshness classe un instant de fraîcheur.
func (s *Service) Freshness(freshAt time.Time) string {
	age := s.now().Sub(freshAt)
	switch {
	case age > s.cfg.ExpiredAfter:
		return FreshnessExpired
	case age > s.cfg.StaleAfter:
		return FreshnessStale
	default:
		return FreshnessFresh
	}
}

// ProductItem est un produit du catalogue, vendu ou non par la station.
type ProductItem struct {
	ID     int16
	Code   string
	Kind   string
	Unit   string
	SizeKg *float64
	Label  string
	Sold   bool
}

// ProductsView est la vue gérant des produits vendus.
type ProductsView struct {
	Version int32
	Items   []ProductItem
}

// StockItem est le stock d'un produit vendu.
type StockItem struct {
	ProductID       int16
	Code            string
	Unit            string
	Label           string
	SizeKg          *float64
	Quantity        int32
	MaxQuantity     int
	UpdatedAt       time.Time
	LastConfirmedAt time.Time
	FreshAt         time.Time
	Freshness       string
}

// StocksView est la vue gérant des stocks.
type StocksView struct {
	Version        int32
	LastActivityAt *time.Time
	Items          []StockItem
}

func (s *Service) maxFor(unit dbgen.ProductUnit) int {
	if unit == dbgen.ProductUnitCylinder {
		return s.cfg.MaxCylinders
	}
	return s.cfg.MaxLiters
}

// Products renvoie le catalogue actif et ce que la station vend.
func (s *Service) Products(ctx context.Context, managerID uuid.UUID) (ProductsView, error) {
	st, err := s.managerStation(ctx, s.Store.Queries, managerID)
	if err != nil {
		return ProductsView{}, err
	}
	rows, err := s.Store.ListStationProducts(ctx, st.ID)
	if err != nil {
		return ProductsView{}, fmt.Errorf("station: list products: %w", err)
	}
	v := ProductsView{Version: st.Version}
	for _, r := range rows {
		v.Items = append(v.Items, ProductItem{
			ID: r.ID, Code: r.Code, Kind: string(r.Kind), Unit: string(r.Unit),
			SizeKg: r.SizeKg, Label: r.LabelFr, Sold: r.Sold,
		})
	}
	return v, nil
}

// SetProducts déclare l'ensemble des produits vendus (D16). Un nouveau produit démarre à 0 (rupture
// jusqu'à la première saisie) ; un produit retiré n'est plus « vendu » (son historique reste).
func (s *Service) SetProducts(ctx context.Context, a Actor, expected int32, productIDs []int16) (ProductsView, error) {
	catalog, err := s.Store.ListActiveProducts(ctx)
	if err != nil {
		return ProductsView{}, fmt.Errorf("station: list catalog: %w", err)
	}
	active := map[int16]bool{}
	for _, p := range catalog {
		active[p.ID] = true
	}
	var f fieldErrors
	seen := map[int16]bool{}
	for i, id := range productIDs {
		switch {
		case seen[id]:
			f.add(fmt.Sprintf("productIds[%d]", i), "duplicate", "each product must appear once")
		case !active[id]:
			f.add(fmt.Sprintf("productIds[%d]", i), "unknown_product", "is not an active product")
		}
		seen[id] = true
	}
	if err := f.err(); err != nil {
		return ProductsView{}, err
	}
	var stationID uuid.UUID
	var removed []int16
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		st, err := s.managerStation(ctx, q, a.UserID)
		if err != nil {
			return err
		}
		stationID = st.ID
		if _, err := bump(ctx, q, st.ID, expected); err != nil {
			return err
		}
		ids := productIDs
		if ids == nil {
			ids = []int16{}
		}
		if removed, err = q.RemoveStationProductsNotIn(ctx, dbgen.RemoveStationProductsNotInParams{StationID: st.ID, ProductIds: ids}); err != nil {
			return fmt.Errorf("station: remove products: %w", err)
		}
		for _, id := range ids {
			if err := q.AddStationProduct(ctx, dbgen.AddStationProductParams{StationID: st.ID, ProductID: id, UpdatedBy: &a.UserID}); err != nil {
				return fmt.Errorf("station: add product: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return ProductsView{}, err
	}
	s.audit(ctx, a, audit.ActionProductsUpdated, stationID, map[string]any{"productIds": productIDs, "removed": removed})
	s.invalidate(ctx, true)
	return s.Products(ctx, a.UserID)
}

// Stocks renvoie les stocks des produits vendus, avec leur fraîcheur.
func (s *Service) Stocks(ctx context.Context, managerID uuid.UUID) (StocksView, error) {
	st, err := s.managerStation(ctx, s.Store.Queries, managerID)
	if err != nil {
		return StocksView{}, err
	}
	rows, err := s.Store.ListStationProducts(ctx, st.ID)
	if err != nil {
		return StocksView{}, fmt.Errorf("station: list stocks: %w", err)
	}
	v := StocksView{Version: st.Version, LastActivityAt: st.LastStockUpdateAt}
	for _, r := range rows {
		if !r.Sold || r.Quantity == nil || r.UpdatedAt == nil || r.LastConfirmedAt == nil {
			continue
		}
		fresh := *r.UpdatedAt
		if r.LastConfirmedAt.After(fresh) {
			fresh = *r.LastConfirmedAt
		}
		v.Items = append(v.Items, StockItem{
			ProductID: r.ID, Code: r.Code, Unit: string(r.Unit), Label: r.LabelFr, SizeKg: r.SizeKg,
			Quantity: *r.Quantity, MaxQuantity: s.maxFor(r.Unit), UpdatedAt: *r.UpdatedAt,
			LastConfirmedAt: *r.LastConfirmedAt, FreshAt: fresh, Freshness: s.Freshness(fresh),
		})
	}
	return v, nil
}

// StockInput est la quantité saisie pour un produit vendu.
type StockInput struct {
	ProductID int16
	Quantity  int
}

// UpdateStocks enregistre la saisie groupée (D16) : un élément par produit vendu, ni plus ni moins.
// Chaque quantité modifiée écrit stock_history ; toute la saisie vaut confirmation (last_confirmed_at).
func (s *Service) UpdateStocks(ctx context.Context, a Actor, expected int32, items []StockInput) (StocksView, error) {
	var stationID uuid.UUID
	var sold, replenished []int16
	changed := 0
	cleared := false
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		st, err := s.managerStation(ctx, q, a.UserID)
		if err != nil {
			return err
		}
		stationID = st.ID
		if _, err := bump(ctx, q, st.ID, expected); err != nil {
			return err
		}
		current, err := q.ListStationStocksForUpdate(ctx, st.ID)
		if err != nil {
			return fmt.Errorf("station: lock stocks: %w", err)
		}
		if len(current) == 0 {
			return apperr.New(http.StatusUnprocessableEntity, CodeNoProductsSold, "Declare the products you sell before entering stocks.")
		}
		byID := map[int16]dbgen.ListStationStocksForUpdateRow{}
		for _, c := range current {
			byID[c.ProductID] = c
			sold = append(sold, c.ProductID)
		}

		var f fieldErrors
		seen := map[int16]bool{}
		for i, it := range items {
			field := fmt.Sprintf("items[%d]", i)
			c, ok := byID[it.ProductID]
			switch {
			case seen[it.ProductID]:
				f.add(field+".productId", "duplicate", "each product must appear once")
			case !ok:
				f.add(field+".productId", "not_sold", "is not a product sold by this station")
			case it.Quantity < 0:
				f.add(field+".quantity", "negative", "must be zero or more")
			case it.Quantity > s.maxFor(c.Unit):
				f.add(field+".quantity", "above_cap", fmt.Sprintf("must be at most %d", s.maxFor(c.Unit)))
			}
			seen[it.ProductID] = true
		}
		for _, id := range sold {
			if !seen[id] {
				f.add("items", "missing_product", fmt.Sprintf("product %s is sold and must be included", byID[id].Code))
			}
		}
		if err := f.err(); err != nil {
			return err
		}

		var history []dbgen.InsertStockHistoryParams
		for _, it := range items {
			c := byID[it.ProductID]
			qty := int32(it.Quantity) //nolint:gosec // borné par les plafonds
			if err := q.SetStockQuantity(ctx, dbgen.SetStockQuantityParams{
				StationID: st.ID, ProductID: it.ProductID,
				Quantity: qty, UpdatedBy: &a.UserID,
			}); err != nil {
				return fmt.Errorf("station: set stock: %w", err)
			}
			if c.Quantity == 0 && qty > 0 {
				replenished = append(replenished, it.ProductID)
			}
			if qty != c.Quantity {
				changed++
				prev := c.Quantity
				history = append(history, dbgen.InsertStockHistoryParams{
					StationID: st.ID, ProductID: it.ProductID,
					Quantity: qty, PreviousQuantity: &prev, Source: dbgen.StockSourceManager, ChangedBy: &a.UserID,
				})
			}
		}
		if len(history) > 0 {
			if _, err := q.InsertStockHistory(ctx, history); err != nil {
				return fmt.Errorf("station: stock history: %w", err)
			}
		}
		cleared, err = stockActivity(ctx, q, st.ID, sold)
		return err
	})
	if err != nil {
		return StocksView{}, err
	}
	// Toute la saisie vaut confirmation : la fraîcheur de chaque produit vendu change. Des effets
	// de signalement levés (badge, exclusion) peuvent concerner toute la station (fermeture).
	s.invalidate(ctx, cleared, sold...)
	s.restocked(ctx, stationID, replenished)
	s.Log.DebugContext(ctx, "station: stocks updated", slog.String("station_id", stationID.String()), slog.Int("changed", changed))
	return s.Stocks(ctx, a.UserID)
}

// ConfirmStocks confirme les stocks actuels en un geste (« rien n'a changé ») : remet le délai de
// fraîcheur à zéro sans modifier les quantités ni updated_at.
func (s *Service) ConfirmStocks(ctx context.Context, a Actor, expected int32) (StocksView, error) {
	var sold []int16
	cleared := false
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		st, err := s.managerStation(ctx, q, a.UserID)
		if err != nil {
			return err
		}
		if _, err := bump(ctx, q, st.ID, expected); err != nil {
			return err
		}
		current, err := q.ListStationStocksForUpdate(ctx, st.ID)
		if err != nil {
			return fmt.Errorf("station: lock stocks: %w", err)
		}
		if len(current) == 0 {
			return apperr.New(http.StatusUnprocessableEntity, CodeNoProductsSold, "Declare the products you sell before confirming stocks.")
		}
		for _, c := range current {
			sold = append(sold, c.ProductID)
		}
		if _, err := q.ConfirmStationStocks(ctx, dbgen.ConfirmStationStocksParams{StationID: st.ID, UpdatedBy: &a.UserID}); err != nil {
			return fmt.Errorf("station: confirm stocks: %w", err)
		}
		cleared, err = stockActivity(ctx, q, st.ID, sold)
		return err
	})
	if err != nil {
		return StocksView{}, err
	}
	slices.Sort(sold)
	s.invalidate(ctx, cleared, sold...)
	return s.Stocks(ctx, a.UserID)
}

// Notes de clôture automatique des signalements et de résolution des alertes admin.
const (
	closedByStockActivity  = "Closed by a stock update or confirmation."
	closedByLocationChange = "Closed by a location change."
	resolvedByActivity     = "Resolved by a stock update or confirmation."
)

// reportCauses désigne les causes de signalement qu'une action du gérant vient de traiter : des
// motifs entiers (station_closed, wrong_location) et des ruptures de produits (out_of_stock).
type reportCauses struct {
	reasons    []string
	productIDs []int16
	note       string
}

// closeReports clôt, dans la transaction, les signalements ouverts des causes traitées, lève leurs
// effets (badge, exclusion) et résout leurs alertes « seuil de signalements ». « Autre » n'en fait
// jamais partie : seul l'admin le clôt. Renvoie true si des effets ont été levés.
func closeReports(ctx context.Context, q *dbgen.Queries, stationID uuid.UUID, c reportCauses) (bool, error) {
	reasons, products := c.reasons, c.productIDs
	if reasons == nil {
		reasons = []string{}
	}
	if products == nil {
		products = []int16{}
	}
	if _, err := q.CloseReportsForCauses(ctx, dbgen.CloseReportsForCausesParams{
		StationID: stationID, Note: &c.note, Reasons: reasons, ProductIds: products,
	}); err != nil {
		return false, fmt.Errorf("station: close reports: %w", err)
	}
	flags, err := q.DeleteReportFlagsForCauses(ctx, dbgen.DeleteReportFlagsForCausesParams{
		StationID: stationID, Reasons: reasons, ProductIds: products,
	})
	if err != nil {
		return false, fmt.Errorf("station: clear report flags: %w", err)
	}
	if _, err := q.AutoResolveReportAlerts(ctx, dbgen.AutoResolveReportAlertsParams{
		StationID: stationID, Resolution: &c.note, Reasons: reasons, ProductIds: products,
	}); err != nil {
		return false, fmt.Errorf("station: resolve report alerts: %w", err)
	}
	return len(flags) > 0, nil
}

// stockActivity enregistre une mise à jour ou une confirmation du gérant, dans sa transaction :
// fraîcheur de la station, fin des rappels « ignorés » et de l'alerte « gérant inactif », clôture
// des signalements que la saisie traite (rupture des produits saisis ou confirmés, station fermée)
// et de leurs effets. Renvoie true si des effets de signalement ont été levés.
func stockActivity(ctx context.Context, q *dbgen.Queries, stationID uuid.UUID, products []int16) (bool, error) {
	if err := q.TouchStationStockActivity(ctx, stationID); err != nil {
		return false, fmt.Errorf("station: touch stock activity: %w", err)
	}
	if err := q.ResetReminderStreak(ctx, stationID); err != nil {
		return false, fmt.Errorf("station: reset reminder streak: %w", err)
	}
	resolution := resolvedByActivity
	if _, err := q.AutoResolveAdminAlerts(ctx, dbgen.AutoResolveAdminAlertsParams{
		StationID: stationID, Resolution: &resolution, Kinds: []string{string(dbgen.AdminAlertKindManagerInactive)},
	}); err != nil {
		return false, fmt.Errorf("station: resolve admin alerts: %w", err)
	}
	return closeReports(ctx, q, stationID, reportCauses{
		reasons: []string{string(dbgen.ReportReasonStationClosed)}, productIDs: products, note: closedByStockActivity,
	})
}

// locationChanged clôt les signalements « position incorrecte » quand la position active change
// (correction du gérant, déplacement validé par l'admin).
func locationChanged(ctx context.Context, q *dbgen.Queries, stationID uuid.UUID) error {
	_, err := closeReports(ctx, q, stationID, reportCauses{
		reasons: []string{string(dbgen.ReportReasonWrongLocation)}, note: closedByLocationChange,
	})
	return err
}

// restocked déclenche les alertes « de retour en stock » (produits passés de 0 à plus de 0),
// après le commit ; un échec est journalisé, la saisie reste enregistrée.
func (s *Service) restocked(ctx context.Context, stationID uuid.UUID, productIDs []int16) {
	if len(productIDs) == 0 || s.Restock == nil {
		return
	}
	if err := s.Restock.EnqueueBackInStock(ctx, stationID, productIDs); err != nil {
		s.Log.ErrorContext(ctx, "station: back-in-stock alerts not queued", slog.Any("err", err))
	}
}
