package handler

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/search"
)

// Search expose la recherche, la fiche publique d'une station et l'itinéraire. Les positions
// reçues en query string ne sont ni stockées ni journalisées (CLAUDE.md, règle 10).
type Search struct {
	rs  *respond.Responder
	svc *search.Service
}

// NewSearch construit le handler.
func NewSearch(rs *respond.Responder, svc *search.Service) *Search {
	return &Search{rs: rs, svc: svc}
}

func queryFloat(r *http.Request, name string) (float64, *apperr.FieldError) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return 0, &apperr.FieldError{Field: name, Code: "required", Message: "is required"}
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, &apperr.FieldError{Field: name, Code: "invalid_type", Message: "must be a number"}
	}
	return v, nil
}

// queryPosition lit lat et lng (obligatoires).
func queryPosition(r *http.Request) (lat, lng float64, fields []apperr.FieldError) {
	lat, ferr := queryFloat(r, "lat")
	if ferr != nil {
		fields = append(fields, *ferr)
	}
	lng, ferr = queryFloat(r, "lng")
	if ferr != nil {
		fields = append(fields, *ferr)
	}
	return lat, lng, fields
}

// ── Recherche ───────────────────────────────────────────────────────────────

type searchProductDTO struct {
	ID    int16  `json:"id"`
	Code  string `json:"code"`
	Label string `json:"label"`
	Unit  string `json:"unit"`
}

type searchStationDTO struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Brand    *string   `json:"brand"`
	Location latLngDTO `json:"location"`
}

type searchResultDTO struct {
	Station        searchStationDTO `json:"station"`
	DistanceM      int              `json:"distanceM"`
	RouteDistanceM *int             `json:"routeDistanceM"`
	DurationS      *int             `json:"durationS"`
	Quantity       int32            `json:"quantity"`
	Stale          bool             `json:"stale"`
	StockUpdatedAt time.Time        `json:"stockUpdatedAt"`
	UpdatedAgoS    int              `json:"updatedAgoS"`
	IsOpen         bool             `json:"isOpen"`
	NextOpening    *time.Time       `json:"nextOpening"`
	ServedAt       *time.Time       `json:"servedAt"`
	Reported       bool             `json:"reported"`
}

type searchResponse struct {
	Product            searchProductDTO  `json:"product"`
	Strategy           string            `json:"strategy"`
	RadiusM            *int              `json:"radiusM"`
	RoutingApproximate bool              `json:"routingApproximate"`
	Results            []searchResultDTO `json:"results"`
	GeneratedAt        time.Time         `json:"generatedAt"`
}

func ms(d time.Duration) string {
	return strconv.FormatFloat(float64(d.Microseconds())/1000, 'f', 1, 64)
}

// Search cherche les stations les plus proches ayant le produit en stock (GET /api/v1/search).
func (h *Search) Search(w http.ResponseWriter, r *http.Request) error {
	lat, lng, fields := queryPosition(r)
	var productID int16
	raw := strings.TrimSpace(r.URL.Query().Get("product_id"))
	if raw == "" {
		fields = append(fields, apperr.FieldError{Field: "product_id", Code: "required", Message: "is required"})
	} else if v, err := strconv.ParseInt(raw, 10, 16); err != nil || v <= 0 {
		fields = append(fields, apperr.FieldError{Field: "product_id", Code: "invalid_type", Message: "must be a positive integer"})
	} else {
		productID = int16(v)
	}
	if len(fields) > 0 {
		return apperr.Validation(fields...)
	}
	res, err := h.svc.Search(r.Context(), search.Query{Lat: lat, Lng: lng, ProductID: productID})
	if err != nil {
		return err
	}
	resp := searchResponse{
		Product:  searchProductDTO{ID: res.Product.ID, Code: res.Product.Code, Label: res.Product.Label, Unit: res.Product.Unit},
		Strategy: res.Strategy, RadiusM: res.RadiusM, RoutingApproximate: res.RoutingApproximate,
		Results: make([]searchResultDTO, 0, len(res.Items)), GeneratedAt: res.GeneratedAt,
	}
	for _, it := range res.Items {
		var next *time.Time
		if it.NextOpening != nil {
			n := it.NextOpening.UTC()
			next = &n
		}
		resp.Results = append(resp.Results, searchResultDTO{
			Station:   searchStationDTO{ID: it.ID.String(), Name: it.Name, Brand: it.Brand, Location: latLngDTO{Lat: it.Lat, Lng: it.Lng}},
			DistanceM: it.DistanceM, RouteDistanceM: it.RouteDistanceM, DurationS: it.DurationS, Quantity: it.Quantity,
			Stale: it.Stale, StockUpdatedAt: it.FreshAt.UTC(), UpdatedAgoS: it.UpdatedAgoS, IsOpen: it.IsOpen,
			NextOpening: next, ServedAt: it.ServedAt, Reported: it.Reported,
		})
	}
	hdr := w.Header()
	// Réponse calculée depuis une position exacte : jamais en cache partagé ni navigateur.
	hdr.Set("Cache-Control", "no-store")
	hdr.Set("X-Cache", map[bool]string{true: "HIT", false: "MISS"}[res.Timing.CacheHit])
	hdr.Set("Server-Timing", fmt.Sprintf("db;dur=%s, osrm;dur=%s, total;dur=%s",
		ms(res.Timing.DB), ms(res.Timing.OSRM), ms(res.Timing.Total)))
	h.rs.JSON(w, r, http.StatusOK, resp)
	return nil
}

// ── Fiche publique ──────────────────────────────────────────────────────────

type publicStockDTO struct {
	ProductID int16     `json:"productId"`
	Code      string    `json:"code"`
	Label     string    `json:"label"`
	Unit      string    `json:"unit"`
	SizeKg    *float64  `json:"sizeKg"`
	Quantity  *int32    `json:"quantity"`
	UpdatedAt time.Time `json:"updatedAt"`
	Freshness string    `json:"freshness"`
	Reported  bool      `json:"reported"`
}

type publicHoursDTO struct {
	Timezone    string     `json:"timezone"`
	IsOpenNow   bool       `json:"isOpenNow"`
	NextOpening *time.Time `json:"nextOpening"`
	Days        []dayDTO   `json:"days"`
	Closures    []string   `json:"closures"`
}

type publicStationDTO struct {
	ID       string           `json:"id"`
	Name     string           `json:"name"`
	Brand    *string          `json:"brand"`
	Address  string           `json:"address"`
	City     *string          `json:"city"`
	Location *latLngDTO       `json:"location"`
	Hours    publicHoursDTO   `json:"openingHours"`
	Stocks   []publicStockDTO `json:"stocks"`
	Reported bool             `json:"reported"`
}

// Station renvoie la fiche publique d'une station approuvée (GET /api/v1/stations/{id}).
func (h *Search) Station(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	st, err := h.svc.PublicStation(r.Context(), id)
	if err != nil {
		return err
	}
	resp := publicStationDTO{
		ID: st.ID.String(), Name: st.Name, Brand: st.Brand, Address: st.Address, City: st.City,
		Hours: publicHoursDTO{
			Timezone: st.Schedule.Loc.String(), IsOpenNow: st.IsOpenNow, NextOpening: st.NextOpening,
			Days: toDays(st.Schedule.Ranges), Closures: st.Closures,
		},
		Stocks:   make([]publicStockDTO, 0, len(st.Stocks)),
		Reported: st.Reported,
	}
	if st.Lat != nil && st.Lng != nil {
		resp.Location = &latLngDTO{Lat: *st.Lat, Lng: *st.Lng}
	}
	for _, s := range st.Stocks {
		resp.Stocks = append(resp.Stocks, publicStockDTO{
			ProductID: s.ProductID, Code: s.Code, Label: s.Label, Unit: s.Unit,
			SizeKg: s.SizeKg, Quantity: s.Quantity, UpdatedAt: s.FreshAt.UTC(), Freshness: s.Freshness,
			Reported: s.Reported,
		})
	}
	w.Header().Set("Cache-Control", "no-cache")
	h.rs.JSON(w, r, http.StatusOK, resp)
	return nil
}

// ── Itinéraire ──────────────────────────────────────────────────────────────

type maneuverDTO struct {
	Type     string    `json:"type"`
	Modifier string    `json:"modifier,omitempty"`
	Exit     int       `json:"exit,omitempty"`
	Location latLngDTO `json:"location"`
}

type routeStepDTO struct {
	Maneuver  maneuverDTO `json:"maneuver"`
	Name      string      `json:"name"`
	Ref       string      `json:"ref,omitempty"`
	DistanceM float64     `json:"distanceM"`
	DurationS float64     `json:"durationS"`
}

type routeResponse struct {
	StationID string         `json:"stationId"`
	DistanceM int            `json:"distanceM"`
	DurationS int            `json:"durationS"`
	Geometry  string         `json:"geometry"`
	Encoding  string         `json:"geometryEncoding"`
	Steps     []routeStepDTO `json:"steps"`
}

// Route calcule l'itinéraire vers une station (GET /api/v1/routes). Les étapes n'ont pas de
// texte : le mobile les traduit en français avec osrm-text-instructions.
func (h *Search) Route(w http.ResponseWriter, r *http.Request) error {
	lat, lng, fields := queryPosition(r)
	stationID, err := uuid.Parse(strings.TrimSpace(r.URL.Query().Get("station_id")))
	if err != nil {
		fields = append(fields, apperr.FieldError{Field: "station_id", Code: "invalid_type", Message: "must be a UUID"})
	}
	if len(fields) > 0 {
		return apperr.Validation(fields...)
	}
	res, err := h.svc.Route(r.Context(), lat, lng, stationID)
	if err != nil {
		return err
	}
	resp := routeResponse{
		StationID: res.StationID.String(), DistanceM: res.DistanceM, DurationS: res.DurationS,
		Geometry: res.Geometry, Encoding: "polyline6", Steps: make([]routeStepDTO, 0, len(res.Steps)),
	}
	for _, s := range res.Steps {
		resp.Steps = append(resp.Steps, routeStepDTO{
			Maneuver: maneuverDTO{Type: s.Type, Modifier: s.Modifier, Exit: s.Exit, Location: latLngDTO{Lat: s.Location.Lat, Lng: s.Location.Lng}},
			Name:     s.Name, Ref: s.Ref, DistanceM: s.DistanceM, DurationS: s.DurationS,
		})
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, resp)
	return nil
}
