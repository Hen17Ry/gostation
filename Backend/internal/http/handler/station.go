package handler

import (
	"bytes"
	"errors"
	"io"
	"mime"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/document"
	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/station"
)

// Stations sert l'espace gérant (/manager/station…) et la validation admin (/admin/stations…).
type Stations struct {
	rs  *respond.Responder
	svc *station.Service
}

// NewStations construit le handler.
func NewStations(rs *respond.Responder, svc *station.Service) *Stations {
	return &Stations{rs: rs, svc: svc}
}

func stationActor(r *http.Request) station.Actor {
	p, _ := httpctx.PrincipalFrom(r.Context())
	return station.Actor{UserID: p.UserID, Role: p.Role}
}

func pathUUID(r *http.Request, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		return uuid.Nil, apperr.BadRequest(apperr.CodeInvalidParameter, "Path parameter "+name+" must be a UUID.")
	}
	return id, nil
}

// ── DTO communs ─────────────────────────────────────────────────────────────

type latLngDTO struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

func latLng(lat, lng *float64) *latLngDTO {
	if lat == nil || lng == nil {
		return nil
	}
	return &latLngDTO{Lat: *lat, Lng: *lng}
}

type locationFlagDTO struct {
	DistanceM int32      `json:"distanceM"`
	AccuracyM *int32     `json:"accuracyM"`
	FlaggedAt *time.Time `json:"flaggedAt"`
}

func locationFlag(at *time.Time, dist, acc *int32) *locationFlagDTO {
	if at == nil || dist == nil {
		return nil
	}
	return &locationFlagDTO{DistanceM: *dist, AccuracyM: acc, FlaggedAt: at}
}

type moveRequestDTO struct {
	ID              string    `json:"id"`
	Location        latLngDTO `json:"location"`
	DistanceM       int32     `json:"distanceM"`
	DeviceDistanceM *int32    `json:"deviceDistanceM"`
	DeviceAccuracyM *int32    `json:"deviceAccuracyM"`
	CreatedAt       time.Time `json:"createdAt"`
}

func moveRequest(m *station.LocationRequest) *moveRequestDTO {
	if m == nil {
		return nil
	}
	return &moveRequestDTO{
		ID: m.ID.String(), Location: latLngDTO{Lat: m.Lat, Lng: m.Lng}, DistanceM: m.DistanceM,
		DeviceDistanceM: m.DeviceDistanceM, DeviceAccuracyM: m.DeviceAccuracyM, CreatedAt: m.CreatedAt,
	}
}

// ── Gérant : station ────────────────────────────────────────────────────────

type setupDTO struct {
	Location     bool     `json:"location"`
	OpeningHours bool     `json:"openingHours"`
	Products     bool     `json:"products"`
	Stocks       bool     `json:"stocks"`
	Searchable   bool     `json:"searchable"`
	Missing      []string `json:"missing"`
}

type managerStationDTO struct {
	ID                string           `json:"id"`
	Status            string           `json:"status"`
	StatusReason      *string          `json:"statusReason"`
	Version           int32            `json:"version"`
	Name              string           `json:"name"`
	Brand             *string          `json:"brand"`
	IFU               string           `json:"ifu"`
	RCCM              string           `json:"rccm"`
	Address           string           `json:"address"`
	City              *string          `json:"city"`
	Phone             string           `json:"phone"`
	Location          *latLngDTO       `json:"location"`
	LocationSetAt     *time.Time       `json:"locationSetAt"`
	LocationFlag      *locationFlagDTO `json:"locationFlag"`
	PendingMove       *moveRequestDTO  `json:"pendingMove"`
	Setup             setupDTO         `json:"setup"`
	LastStockUpdateAt *time.Time       `json:"lastStockUpdateAt"`
	CreatedAt         time.Time        `json:"createdAt"`
	UpdatedAt         time.Time        `json:"updatedAt"`
}

func toManagerStation(st station.ManagerStation) managerStationDTO {
	return managerStationDTO{
		ID: st.ID.String(), Status: string(st.Status), StatusReason: st.StatusReason, Version: st.Version,
		Name: st.Name, Brand: st.Brand, IFU: st.Ifu, RCCM: st.Rccm, Address: st.Address, City: st.City, Phone: st.Phone,
		Location: latLng(st.Lat, st.Lng), LocationSetAt: st.LocationSetAt,
		LocationFlag: locationFlag(st.LocationFlaggedAt, st.LocationFlagDistanceM, st.LocationFlagAccuracyM),
		PendingMove:  moveRequest(st.PendingMove), LastStockUpdateAt: st.LastStockUpdateAt,
		CreatedAt: st.CreatedAt, UpdatedAt: st.UpdatedAt,
		Setup: setupDTO{
			Location: st.Setup.Location, OpeningHours: st.Setup.OpeningHours, Products: st.Setup.Products,
			Stocks: st.Setup.Stocks, Searchable: st.Setup.Searchable(), Missing: st.Setup.Missing,
		},
	}
}

func (h *Stations) writeStation(w http.ResponseWriter, r *http.Request, status int, st station.ManagerStation) {
	setETag(w, st.Version)
	h.rs.JSON(w, r, status, toManagerStation(st))
}

// ManagerStation renvoie la station du gérant (GET /manager/station).
func (h *Stations) ManagerStation(w http.ResponseWriter, r *http.Request) error {
	st, err := h.svc.ForManager(r.Context(), stationActor(r).UserID)
	if err != nil {
		return err
	}
	h.writeStation(w, r, http.StatusOK, st)
	return nil
}

type updateStationRequest struct {
	Name    *string `json:"name"`
	Brand   *string `json:"brand"`
	Address *string `json:"address"`
	City    *string `json:"city"`
	Phone   *string `json:"phone"`
	IFU     *string `json:"ifu"`
	RCCM    *string `json:"rccm"`
}

// UpdateStation modifie le profil (PATCH /manager/station). IFU ou RCCM modifié → pending.
func (h *Stations) UpdateStation(w http.ResponseWriter, r *http.Request) error {
	v, err := expectedVersion(r)
	if err != nil {
		return err
	}
	var req updateStationRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	st, err := h.svc.UpdateProfile(r.Context(), stationActor(r), v, station.ProfileInput(req))
	if err != nil {
		return err
	}
	h.writeStation(w, r, http.StatusOK, st)
	return nil
}

type devicePositionRequest struct {
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	AccuracyM float64 `json:"accuracyM"`
}

type setLocationRequest struct {
	Lat                    *float64               `json:"lat"`
	Lng                    *float64               `json:"lng"`
	ConfirmStationLocation bool                   `json:"confirmStationLocation"`
	Device                 *devicePositionRequest `json:"device"`
}

type setLocationResponse struct {
	Outcome string            `json:"outcome"`
	Flagged bool              `json:"flagged"`
	Station managerStationDTO `json:"station"`
}

// SetLocation épingle la station (PUT /manager/station/location) : 200 si appliqué, 202 si le
// déplacement (≥ 200 m) attend la validation de l'admin.
func (h *Stations) SetLocation(w http.ResponseWriter, r *http.Request) error {
	v, err := expectedVersion(r)
	if err != nil {
		return err
	}
	var req setLocationRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	if req.Lat == nil || req.Lng == nil {
		return apperr.Validation(apperr.FieldError{Field: "lat", Code: "required", Message: "lat and lng are required"})
	}
	in := station.LocationInput{Lat: *req.Lat, Lng: *req.Lng, Confirm: req.ConfirmStationLocation}
	if req.Device != nil {
		in.Device = &station.DevicePosition{Lat: req.Device.Lat, Lng: req.Device.Lng, AccuracyM: req.Device.AccuracyM}
	}
	res, err := h.svc.SetLocation(r.Context(), stationActor(r), v, in)
	if err != nil {
		return err
	}
	status := http.StatusOK
	if res.Outcome == station.OutcomeMoveRequested {
		status = http.StatusAccepted
	}
	setETag(w, res.Station.Version)
	h.rs.JSON(w, r, status, setLocationResponse{Outcome: res.Outcome, Flagged: res.Flagged, Station: toManagerStation(res.Station)})
	return nil
}

// Resubmit renvoie un justificatif après un rejet (POST /manager/station/resubmission, multipart,
// champ « document ») : la station repasse en pending.
func (h *Stations) Resubmit(w http.ResponseWriter, r *http.Request) error {
	v, err := expectedVersion(r)
	if err != nil {
		return err
	}
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "multipart/form-data" {
		return apperr.New(http.StatusUnsupportedMediaType, apperr.CodeInvalidParameter, "Content-Type must be multipart/form-data.")
	}
	mr, err := r.MultipartReader()
	if err != nil {
		return apperr.BadRequest(apperr.CodeInvalidParameter, "Malformed multipart body.").Wrap(err)
	}
	var doc []byte
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			var maxBytes *http.MaxBytesError
			if errors.As(err, &maxBytes) {
				return err
			}
			return apperr.BadRequest(apperr.CodeInvalidParameter, "Malformed multipart body.").Wrap(err)
		}
		if part.FormName() != "document" || doc != nil {
			return apperr.Validation(apperr.FieldError{Field: part.FormName(), Code: "unknown_field", Message: "only one document part is accepted"})
		}
		if doc, err = io.ReadAll(part); err != nil {
			return err
		}
	}
	var reader io.Reader
	if doc != nil {
		reader = bytes.NewReader(doc)
	}
	st, err := h.svc.Resubmit(r.Context(), stationActor(r), v, reader)
	if err != nil {
		return err
	}
	h.writeStation(w, r, http.StatusOK, st)
	return nil
}

// ── Gérant : horaires et fermetures ─────────────────────────────────────────

type rangeDTO struct {
	Opens  string `json:"opens"`
	Closes string `json:"closes"`
}

type dayDTO struct {
	Weekday int        `json:"weekday"`
	Is24h   bool       `json:"is24h"`
	Ranges  []rangeDTO `json:"ranges"`
}

type closureDTO struct {
	ID        string    `json:"id"`
	Date      string    `json:"date"`
	Reason    *string   `json:"reason"`
	CreatedAt time.Time `json:"createdAt"`
}

type hoursResponse struct {
	Timezone    string       `json:"timezone"`
	IsOpenNow   bool         `json:"isOpenNow"`
	NextOpening *time.Time   `json:"nextOpening"`
	Days        []dayDTO     `json:"days"`
	Closures    []closureDTO `json:"closures"`
}

func toClosure(c station.Closure) closureDTO {
	return closureDTO{ID: c.ID.String(), Date: c.Date.Format(time.DateOnly), Reason: c.Reason, CreatedAt: c.CreatedAt}
}

func toHours(v station.HoursView, tz string) hoursResponse {
	resp := hoursResponse{Timezone: tz, IsOpenNow: v.IsOpenNow, Days: []dayDTO{}, Closures: []closureDTO{}}
	if v.NextOpening != nil {
		next := v.NextOpening.UTC()
		resp.NextOpening = &next
	}
	resp.Days = toDays(v.Ranges)
	for _, c := range v.Closures {
		resp.Closures = append(resp.Closures, toClosure(c))
	}
	return resp
}

// toDays regroupe les plages par jour ISO (ordre lundi → dimanche, puis heure d'ouverture).
func toDays(ranges []station.Range) []dayDTO {
	sorted := slices.Clone(ranges)
	slices.SortFunc(sorted, func(a, b station.Range) int {
		if a.Weekday != b.Weekday {
			return a.Weekday - b.Weekday
		}
		return a.Opens - b.Opens
	})
	days := []dayDTO{}
	for _, rg := range sorted {
		if len(days) == 0 || days[len(days)-1].Weekday != rg.Weekday {
			days = append(days, dayDTO{Weekday: rg.Weekday, Ranges: []rangeDTO{}})
		}
		d := &days[len(days)-1]
		if rg.Is24h() {
			d.Is24h = true
			continue
		}
		d.Ranges = append(d.Ranges, rangeDTO{Opens: station.FormatClock(rg.Opens), Closes: station.FormatClock(rg.Closes)})
	}
	return days
}

// Hours renvoie les horaires et les fermetures à venir (GET /manager/station/opening-hours).
func (h *Stations) Hours(w http.ResponseWriter, r *http.Request) error {
	v, err := h.svc.Hours(r.Context(), stationActor(r).UserID)
	if err != nil {
		return err
	}
	setETag(w, v.Version)
	h.rs.JSON(w, r, http.StatusOK, toHours(v, h.svc.Timezone()))
	return nil
}

type replaceHoursRequest struct {
	AllWeek24h bool     `json:"allWeek24h"`
	Days       []dayDTO `json:"days"`
}

// ReplaceHours remplace la semaine (PUT /manager/station/opening-hours). Jour absent = fermé.
func (h *Stations) ReplaceHours(w http.ResponseWriter, r *http.Request) error {
	v, err := expectedVersion(r)
	if err != nil {
		return err
	}
	var req replaceHoursRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	in := station.HoursInput{AllWeek24h: req.AllWeek24h}
	for _, d := range req.Days {
		di := station.DayInput{Weekday: d.Weekday, Is24h: d.Is24h}
		for _, rg := range d.Ranges {
			di.Ranges = append(di.Ranges, station.RangeInput{Opens: rg.Opens, Closes: rg.Closes})
		}
		in.Days = append(in.Days, di)
	}
	view, err := h.svc.ReplaceHours(r.Context(), stationActor(r), v, in)
	if err != nil {
		return err
	}
	setETag(w, view.Version)
	h.rs.JSON(w, r, http.StatusOK, toHours(view, h.svc.Timezone()))
	return nil
}

type addClosureRequest struct {
	Date   string  `json:"date"`
	Reason *string `json:"reason"`
}

// AddClosure ajoute une fermeture exceptionnelle (POST /manager/station/closures).
func (h *Stations) AddClosure(w http.ResponseWriter, r *http.Request) error {
	v, err := expectedVersion(r)
	if err != nil {
		return err
	}
	var req addClosureRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	c, version, err := h.svc.AddClosure(r.Context(), stationActor(r), v, req.Date, req.Reason)
	if err != nil {
		return err
	}
	setETag(w, version)
	h.rs.JSON(w, r, http.StatusCreated, toClosure(c))
	return nil
}

// DeleteClosure supprime une fermeture (DELETE /manager/station/closures/{id}).
func (h *Stations) DeleteClosure(w http.ResponseWriter, r *http.Request) error {
	v, err := expectedVersion(r)
	if err != nil {
		return err
	}
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	version, err := h.svc.DeleteClosure(r.Context(), stationActor(r), v, id)
	if err != nil {
		return err
	}
	setETag(w, version)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ── Gérant : produits vendus et stocks ──────────────────────────────────────

type stationProductDTO struct {
	ID     int16    `json:"id"`
	Code   string   `json:"code"`
	Kind   string   `json:"kind"`
	Unit   string   `json:"unit"`
	SizeKg *float64 `json:"sizeKg"`
	Label  string   `json:"label"`
	Sold   bool     `json:"sold"`
}

func (h *Stations) writeProducts(w http.ResponseWriter, r *http.Request, v station.ProductsView) {
	items := make([]stationProductDTO, 0, len(v.Items))
	for _, p := range v.Items {
		items = append(items, stationProductDTO{ID: p.ID, Code: p.Code, Kind: p.Kind, Unit: p.Unit, SizeKg: p.SizeKg, Label: p.Label, Sold: p.Sold})
	}
	setETag(w, v.Version)
	h.rs.JSON(w, r, http.StatusOK, listResponse[stationProductDTO]{Items: items})
}

// Products renvoie le catalogue et les produits vendus (GET /manager/station/products).
func (h *Stations) Products(w http.ResponseWriter, r *http.Request) error {
	v, err := h.svc.Products(r.Context(), stationActor(r).UserID)
	if err != nil {
		return err
	}
	h.writeProducts(w, r, v)
	return nil
}

type setProductsRequest struct {
	ProductIDs []int16 `json:"productIds"`
}

// SetProducts déclare les produits vendus (PUT /manager/station/products).
func (h *Stations) SetProducts(w http.ResponseWriter, r *http.Request) error {
	v, err := expectedVersion(r)
	if err != nil {
		return err
	}
	var req setProductsRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	if req.ProductIDs == nil {
		return apperr.Validation(apperr.FieldError{Field: "productIds", Code: "required", Message: "is required (empty list = nothing sold)"})
	}
	view, err := h.svc.SetProducts(r.Context(), stationActor(r), v, req.ProductIDs)
	if err != nil {
		return err
	}
	h.writeProducts(w, r, view)
	return nil
}

type stockDTO struct {
	ProductID       int16     `json:"productId"`
	Code            string    `json:"code"`
	Label           string    `json:"label"`
	Unit            string    `json:"unit"`
	SizeKg          *float64  `json:"sizeKg"`
	Quantity        int32     `json:"quantity"`
	MaxQuantity     int       `json:"maxQuantity"`
	UpdatedAt       time.Time `json:"updatedAt"`
	LastConfirmedAt time.Time `json:"lastConfirmedAt"`
	FreshAt         time.Time `json:"freshAt"`
	Freshness       string    `json:"freshness"`
}

type stocksResponse struct {
	LastActivityAt *time.Time `json:"lastActivityAt"`
	Items          []stockDTO `json:"items"`
}

func (h *Stations) writeStocks(w http.ResponseWriter, r *http.Request, v station.StocksView) {
	resp := stocksResponse{LastActivityAt: v.LastActivityAt, Items: make([]stockDTO, 0, len(v.Items))}
	for _, it := range v.Items {
		resp.Items = append(resp.Items, stockDTO{
			ProductID: it.ProductID, Code: it.Code, Label: it.Label, Unit: it.Unit,
			SizeKg: it.SizeKg, Quantity: it.Quantity, MaxQuantity: it.MaxQuantity, UpdatedAt: it.UpdatedAt,
			LastConfirmedAt: it.LastConfirmedAt, FreshAt: it.FreshAt, Freshness: it.Freshness,
		})
	}
	setETag(w, v.Version)
	h.rs.JSON(w, r, http.StatusOK, resp)
}

// Stocks renvoie les stocks des produits vendus (GET /manager/station/stocks).
func (h *Stations) Stocks(w http.ResponseWriter, r *http.Request) error {
	v, err := h.svc.Stocks(r.Context(), stationActor(r).UserID)
	if err != nil {
		return err
	}
	h.writeStocks(w, r, v)
	return nil
}

type stockItemRequest struct {
	ProductID int16 `json:"productId"`
	Quantity  int   `json:"quantity"`
}

type updateStocksRequest struct {
	Items []stockItemRequest `json:"items"`
}

// UpdateStocks enregistre la saisie groupée (PUT /manager/station/stocks).
func (h *Stations) UpdateStocks(w http.ResponseWriter, r *http.Request) error {
	v, err := expectedVersion(r)
	if err != nil {
		return err
	}
	var req updateStocksRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	items := make([]station.StockInput, len(req.Items))
	for i, it := range req.Items {
		items[i] = station.StockInput{ProductID: it.ProductID, Quantity: it.Quantity}
	}
	view, err := h.svc.UpdateStocks(r.Context(), stationActor(r), v, items)
	if err != nil {
		return err
	}
	h.writeStocks(w, r, view)
	return nil
}

// ConfirmStocks confirme les stocks actuels (POST /manager/station/stocks/confirm).
func (h *Stations) ConfirmStocks(w http.ResponseWriter, r *http.Request) error {
	v, err := expectedVersion(r)
	if err != nil {
		return err
	}
	view, err := h.svc.ConfirmStocks(r.Context(), stationActor(r), v)
	if err != nil {
		return err
	}
	h.writeStocks(w, r, view)
	return nil
}

// ── Admin ───────────────────────────────────────────────────────────────────

type adminStationSummaryDTO struct {
	ID                   string     `json:"id"`
	Name                 string     `json:"name"`
	Brand                *string    `json:"brand"`
	IFU                  string     `json:"ifu"`
	City                 *string    `json:"city"`
	Status               string     `json:"status"`
	Version              int32      `json:"version"`
	Location             *latLngDTO `json:"location"`
	ManagerEmailVerified bool       `json:"managerEmailVerified"`
	LocationFlagged      bool       `json:"locationFlagged"`
	HasPendingMove       bool       `json:"hasPendingMove"`
	HasOpeningHours      bool       `json:"hasOpeningHours"`
	LastStockUpdateAt    *time.Time `json:"lastStockUpdateAt"`
	Freshness            string     `json:"freshness"` // fresh | stale | expired | none (jamais saisi)
	Reported             bool       `json:"reported"`
	ManagerInactive      bool       `json:"managerInactive"`
	CreatedAt            time.Time  `json:"createdAt"`
	UpdatedAt            time.Time  `json:"updatedAt"`
}

type adminStationPage struct {
	Items      []adminStationSummaryDTO `json:"items"`
	NextCursor *string                  `json:"nextCursor"`
}

// AdminList liste les stations (GET /admin/stations?status&q&needsReview&freshness&managerInactive&
// noHours&reported&cursor&limit). Statut par défaut : pending ; « all » = tous.
func (h *Stations) AdminList(w http.ResponseWriter, r *http.Request) error {
	q, err := strictQuery(r, "status", "q", "needsReview", "freshness", "managerInactive", "noHours", "reported", "cursor", "limit")
	if err != nil {
		return err
	}
	f := station.AdminFilter{Status: q.Get("status"), Query: q.Get("q"), Freshness: q.Get("freshness"), Cursor: q.Get("cursor")}
	if f.Status == "" {
		f.Status = station.StatusPending
	}
	for name, dst := range map[string]*bool{
		"needsReview": &f.NeedsReview, "managerInactive": &f.ManagerInactive, "noHours": &f.NoHours, "reported": &f.Reported,
	} {
		b, err := queryBool(q, name)
		if err != nil {
			return err
		}
		if b != nil {
			*dst = *b
		}
	}
	if f.Limit, err = queryInt(q, "limit"); err != nil {
		return err
	}
	page, err := h.svc.AdminList(r.Context(), f)
	if err != nil {
		return err
	}
	resp := adminStationPage{Items: make([]adminStationSummaryDTO, 0, len(page.Items))}
	for _, s := range page.Items {
		resp.Items = append(resp.Items, adminStationSummaryDTO{
			ID: s.ID.String(), Name: s.Name, Brand: s.Brand, IFU: s.Ifu, City: s.City, Status: string(s.Status),
			Version: s.Version, Location: latLng(s.Lat, s.Lng), ManagerEmailVerified: s.ManagerEmailVerified,
			LocationFlagged: s.LocationFlaggedAt != nil, HasPendingMove: s.HasPendingMove, HasOpeningHours: s.HasOpeningHours,
			LastStockUpdateAt: s.LastStockUpdateAt, Freshness: h.svc.StationFreshness(s.LastStockUpdateAt),
			Reported: s.Reported, ManagerInactive: s.ManagerInactive, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt,
		})
	}
	if page.NextCursor != "" {
		resp.NextCursor = &page.NextCursor
	}
	h.rs.JSON(w, r, http.StatusOK, resp)
	return nil
}

type pointDTO struct {
	Type        string     `json:"type"`
	Coordinates [2]float64 `json:"coordinates"` // [lng, lat] (ordre GeoJSON)
}

type mapFeatureDTO struct {
	Type       string   `json:"type"`
	ID         string   `json:"id"`
	Geometry   pointDTO `json:"geometry"`
	Properties struct {
		Name      string `json:"name"`
		Status    string `json:"status"`
		Freshness string `json:"freshness"`
		Reported  bool   `json:"reported"`
	} `json:"properties"`
}

type mapCollectionDTO struct {
	Type     string          `json:"type"`
	Features []mapFeatureDTO `json:"features"`
}

// AdminMap renvoie toutes les stations épinglées en GeoJSON léger (statut, fraîcheur, signalée),
// pour une carte avec regroupement côté client (GET /admin/stations/map?status).
func (h *Stations) AdminMap(w http.ResponseWriter, r *http.Request) error {
	q, err := strictQuery(r, "status")
	if err != nil {
		return err
	}
	stations, err := h.svc.Map(r.Context(), q.Get("status"))
	if err != nil {
		return err
	}
	out := mapCollectionDTO{Type: "FeatureCollection", Features: make([]mapFeatureDTO, 0, len(stations))}
	for _, s := range stations {
		if s.Lat == nil || s.Lng == nil {
			continue
		}
		f := mapFeatureDTO{Type: "Feature", ID: s.ID.String(), Geometry: pointDTO{Type: "Point", Coordinates: [2]float64{*s.Lng, *s.Lat}}}
		f.Properties.Name, f.Properties.Status, f.Properties.Freshness, f.Properties.Reported = s.Name, string(s.Status), s.Freshness, s.Reported
		out.Features = append(out.Features, f)
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSONType(w, r, http.StatusOK, respond.ContentTypeGeoJSON, out)
	return nil
}

type adminUpdateStationRequest struct {
	Name    *string `json:"name"`
	Brand   *string `json:"brand"`
	Address *string `json:"address"`
	City    *string `json:"city"`
	Phone   *string `json:"phone"`
	IFU     *string `json:"ifu"`
	RCCM    *string `json:"rccm"`
	Reason  string  `json:"reason"`
}

// AdminUpdate corrige les informations d'une station, motif obligatoire (PATCH /admin/stations/{id}).
func (h *Stations) AdminUpdate(w http.ResponseWriter, r *http.Request) error {
	v, err := expectedVersion(r)
	if err != nil {
		return err
	}
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var req adminUpdateStationRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	in := station.ProfileInput{Name: req.Name, Brand: req.Brand, Address: req.Address, City: req.City, Phone: req.Phone, IFU: req.IFU, RCCM: req.RCCM}
	st, err := h.svc.AdminUpdate(r.Context(), stationActor(r), id, v, in, req.Reason)
	if err != nil {
		return err
	}
	h.writeAdminStation(w, r, st)
	return nil
}

type adminManagerDTO struct {
	ID            string `json:"id"`
	FirstName     string `json:"firstName"`
	LastName      string `json:"lastName"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"emailVerified"`
}

type adminStationDTO struct {
	ID                string           `json:"id"`
	Status            string           `json:"status"`
	StatusReason      *string          `json:"statusReason"`
	ReviewedAt        *time.Time       `json:"reviewedAt"`
	Version           int32            `json:"version"`
	Name              string           `json:"name"`
	Brand             *string          `json:"brand"`
	IFU               string           `json:"ifu"`
	RCCM              string           `json:"rccm"`
	Address           string           `json:"address"`
	City              *string          `json:"city"`
	Phone             string           `json:"phone"`
	Location          *latLngDTO       `json:"location"`
	LocationSetAt     *time.Time       `json:"locationSetAt"`
	LocationFlag      *locationFlagDTO `json:"locationFlag"`
	PendingMove       *moveRequestDTO  `json:"pendingMove"`
	DocumentMime      *string          `json:"documentMime"`
	Manager           *adminManagerDTO `json:"manager"`
	LastStockUpdateAt *time.Time       `json:"lastStockUpdateAt"`
	StatusChangedAt   time.Time        `json:"statusChangedAt"`
	CreatedAt         time.Time        `json:"createdAt"`
	UpdatedAt         time.Time        `json:"updatedAt"`
}

func (h *Stations) writeAdminStation(w http.ResponseWriter, r *http.Request, st station.AdminStation) {
	d := adminStationDTO{
		ID: st.ID.String(), Status: string(st.Status), StatusReason: st.StatusReason, ReviewedAt: st.ReviewedAt,
		Version: st.Version, Name: st.Name, Brand: st.Brand, IFU: st.Ifu, RCCM: st.Rccm, Address: st.Address,
		City: st.City, Phone: st.Phone, Location: latLng(st.Lat, st.Lng), LocationSetAt: st.LocationSetAt,
		LocationFlag: locationFlag(st.LocationFlaggedAt, st.LocationFlagDistanceM, st.LocationFlagAccuracyM),
		PendingMove:  moveRequest(st.PendingMove), DocumentMime: st.DocumentMime,
		LastStockUpdateAt: st.LastStockUpdateAt, StatusChangedAt: st.StatusChangedAt, CreatedAt: st.CreatedAt, UpdatedAt: st.UpdatedAt,
	}
	if st.ManagerID != nil && st.ManagerEmail != nil {
		d.Manager = &adminManagerDTO{
			ID: st.ManagerID.String(), FirstName: deref(st.ManagerFirstName),
			LastName: deref(st.ManagerLastName), Email: *st.ManagerEmail, EmailVerified: st.ManagerEmailVerifiedAt != nil,
		}
	}
	setETag(w, st.Version)
	h.rs.JSON(w, r, http.StatusOK, d)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// AdminDetail renvoie le détail d'une station (GET /admin/stations/{id}).
func (h *Stations) AdminDetail(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	st, err := h.svc.AdminDetail(r.Context(), id)
	if err != nil {
		return err
	}
	h.writeAdminStation(w, r, st)
	return nil
}

type reasonRequest struct {
	Reason string `json:"reason"`
}

// decision sert approve, reject, suspend et unsuspend (POST /admin/stations/{id}/{decision}).
func (h *Stations) decision(name string, withReason bool) Func {
	return func(w http.ResponseWriter, r *http.Request) error {
		v, err := expectedVersion(r)
		if err != nil {
			return err
		}
		id, err := pathUUID(r, "id")
		if err != nil {
			return err
		}
		var req reasonRequest
		if withReason {
			if err := decodeJSON(r, &req, false); err != nil {
				return err
			}
		}
		st, err := h.svc.ChangeStatus(r.Context(), stationActor(r), id, v, name, req.Reason)
		if err != nil {
			return err
		}
		h.writeAdminStation(w, r, st)
		return nil
	}
}

// Approve, Reject, Suspend, Unsuspend : décisions de l'admin (motif obligatoire sauf approve).
func (h *Stations) Approve() Func   { return h.decision("approve", false) }
func (h *Stations) Reject() Func    { return h.decision("reject", true) }
func (h *Stations) Suspend() Func   { return h.decision("suspend", true) }
func (h *Stations) Unsuspend() Func { return h.decision("unsuspend", true) }

func (h *Stations) resolveMove(approve bool) Func {
	return func(w http.ResponseWriter, r *http.Request) error {
		v, err := expectedVersion(r)
		if err != nil {
			return err
		}
		id, err := pathUUID(r, "id")
		if err != nil {
			return err
		}
		requestID, err := pathUUID(r, "requestId")
		if err != nil {
			return err
		}
		var req reasonRequest
		if !approve {
			if err := decodeJSON(r, &req, false); err != nil {
				return err
			}
		}
		st, err := h.svc.ResolveMove(r.Context(), stationActor(r), id, requestID, v, approve, req.Reason)
		if err != nil {
			return err
		}
		h.writeAdminStation(w, r, st)
		return nil
	}
}

// ApproveMove et RejectMove traitent une demande de déplacement
// (POST /admin/stations/{id}/location-requests/{requestId}/approve|reject).
func (h *Stations) ApproveMove() Func { return h.resolveMove(true) }
func (h *Stations) RejectMove() Func  { return h.resolveMove(false) }

// DismissLocationFlag lève le signalement d'épingle (POST /admin/stations/{id}/location-flag/dismiss).
func (h *Stations) DismissLocationFlag(w http.ResponseWriter, r *http.Request) error {
	v, err := expectedVersion(r)
	if err != nil {
		return err
	}
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	st, err := h.svc.DismissLocationFlag(r.Context(), stationActor(r), id, v)
	if err != nil {
		return err
	}
	h.writeAdminStation(w, r, st)
	return nil
}

// AdminDocument sert le justificatif déchiffré d'une station à un admin
// (GET /admin/stations/{id}/document). Jamais mis en cache, jamais affiché en ligne :
// téléchargement forcé, aucun script exécutable (CSP sandbox).
func (h *Stations) AdminDocument(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	p, _ := httpctx.PrincipalFrom(r.Context())
	data, mimeType, err := h.svc.Document(r.Context(), p.UserID, id)
	if err != nil {
		return err
	}
	ext := map[string]string{document.MIMEPDF: "pdf", document.MIMEJPEG: "jpg", document.MIMEPNG: "png"}[mimeType]
	hd := w.Header()
	hd.Set("Content-Type", mimeType)
	hd.Set("Content-Length", strconv.Itoa(len(data)))
	hd.Set("Content-Disposition", `attachment; filename="station-`+id.String()+`.`+ext+`"`)
	hd.Set("Cache-Control", "no-store")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data) //nolint:gosec // G705 : pièce jointe téléchargée (nosniff, CSP sandbox), jamais rendue
	return nil
}
