package handler

import (
	"net/http"
	"time"

	"gostation/backend/internal/favorite"
	"gostation/backend/internal/http/respond"
)

// Favorites sert les stations favorites (/me/favorites).
type Favorites struct {
	rs  *respond.Responder
	svc *favorite.Service
}

// NewFavorites construit le handler.
func NewFavorites(rs *respond.Responder, svc *favorite.Service) *Favorites {
	return &Favorites{rs: rs, svc: svc}
}

type favoriteStationDTO struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	Brand    *string    `json:"brand"`
	Address  string     `json:"address"`
	City     *string    `json:"city"`
	Location *latLngDTO `json:"location"`
}

type favoriteDTO struct {
	Station         favoriteStationDTO `json:"station"`
	Available       bool               `json:"available"`
	AlertProductIDs []int16            `json:"alertProductIds"`
	CreatedAt       time.Time          `json:"createdAt"`
}

func toFavorite(f favorite.Favorite) favoriteDTO {
	return favoriteDTO{
		Station: favoriteStationDTO{
			ID: f.StationID.String(), Name: f.Name, Brand: f.Brand, Address: f.Address, City: f.City,
			Location: latLng(f.Lat, f.Lng),
		},
		Available: f.Available, AlertProductIDs: f.AlertProductIDs, CreatedAt: f.CreatedAt,
	}
}

// List renvoie les favoris (GET /me/favorites).
func (h *Favorites) List(w http.ResponseWriter, r *http.Request) error {
	favs, err := h.svc.List(r.Context(), principal(r).UserID)
	if err != nil {
		return err
	}
	items := make([]favoriteDTO, 0, len(favs))
	for _, f := range favs {
		items = append(items, toFavorite(f))
	}
	h.rs.JSON(w, r, http.StatusOK, listResponse[favoriteDTO]{Items: items})
	return nil
}

type addFavoriteRequest struct {
	// AlertProductIDs remplace les produits suivis (alerte « de retour en stock ») ; absent :
	// inchangé.
	AlertProductIDs *[]int16 `json:"alertProductIds"`
}

// Add ajoute une station aux favoris, ou met à jour ses alertes (POST /me/favorites/{stationId}) :
// 201 à la création, 200 si elle y était déjà.
func (h *Favorites) Add(w http.ResponseWriter, r *http.Request) error {
	stationID, err := pathUUID(r, "stationId")
	if err != nil {
		return err
	}
	var req addFavoriteRequest
	if err := decodeJSON(r, &req, true); err != nil {
		return err
	}
	f, created, err := h.svc.Add(r.Context(), principal(r).UserID, stationID, req.AlertProductIDs)
	if err != nil {
		return err
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	h.rs.JSON(w, r, status, toFavorite(f))
	return nil
}

// Remove retire une station des favoris (DELETE /me/favorites/{stationId}), idempotent.
func (h *Favorites) Remove(w http.ResponseWriter, r *http.Request) error {
	stationID, err := pathUUID(r, "stationId")
	if err != nil {
		return err
	}
	if err := h.svc.Remove(r.Context(), principal(r).UserID, stationID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
