package handler

import (
	"net/http"
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

// Stations sert les routes gérant (/manager/station) et admin (/admin/stations/…).
type Stations struct {
	rs  *respond.Responder
	svc *station.Service
}

// NewStations construit le handler.
func NewStations(rs *respond.Responder, svc *station.Service) *Stations {
	return &Stations{rs: rs, svc: svc}
}

type latLngDTO struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type managerStationDTO struct {
	ID                string     `json:"id"`
	Status            string     `json:"status"`
	Name              string     `json:"name"`
	Brand             *string    `json:"brand"`
	IFU               string     `json:"ifu"`
	RCCM              string     `json:"rccm"`
	Address           string     `json:"address"`
	City              *string    `json:"city"`
	Phone             string     `json:"phone"`
	Location          *latLngDTO `json:"location"`
	LocationSetAt     *time.Time `json:"locationSetAt"`
	LastStockUpdateAt *time.Time `json:"lastStockUpdateAt"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

// ManagerStation renvoie la station du gérant approuvé (GET /manager/station).
func (h *Stations) ManagerStation(w http.ResponseWriter, r *http.Request) error {
	p, _ := httpctx.PrincipalFrom(r.Context())
	st, err := h.svc.ForManager(r.Context(), p.UserID)
	if err != nil {
		return err
	}
	d := managerStationDTO{
		ID: st.ID.String(), Status: string(st.Status), Name: st.Name, Brand: st.Brand, IFU: st.Ifu, RCCM: st.Rccm,
		Address: st.Address, City: st.City, Phone: st.Phone, LocationSetAt: st.LocationSetAt,
		LastStockUpdateAt: st.LastStockUpdateAt, CreatedAt: st.CreatedAt, UpdatedAt: st.UpdatedAt,
	}
	if st.Lat != nil && st.Lng != nil {
		d.Location = &latLngDTO{Lat: *st.Lat, Lng: *st.Lng}
	}
	h.rs.JSON(w, r, http.StatusOK, d)
	return nil
}

// AdminDocument sert le justificatif déchiffré d'une station à un admin
// (GET /admin/stations/{id}/document). Jamais mis en cache, jamais affiché en ligne :
// téléchargement forcé, aucun script exécutable (CSP sandbox).
func (h *Stations) AdminDocument(w http.ResponseWriter, r *http.Request) error {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return apperr.BadRequest(apperr.CodeInvalidParameter, "Station id must be a UUID.")
	}
	p, _ := httpctx.PrincipalFrom(r.Context())
	data, mime, err := h.svc.Document(r.Context(), p.UserID, id)
	if err != nil {
		return err
	}
	ext := map[string]string{document.MIMEPDF: "pdf", document.MIMEJPEG: "jpg", document.MIMEPNG: "png"}[mime]
	hd := w.Header()
	hd.Set("Content-Type", mime)
	hd.Set("Content-Length", strconv.Itoa(len(data)))
	hd.Set("Content-Disposition", `attachment; filename="station-`+id.String()+`.`+ext+`"`)
	hd.Set("Cache-Control", "no-store")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data) //nolint:gosec // G705 : pièce jointe téléchargée (nosniff, CSP sandbox), jamais rendue
	return nil
}
