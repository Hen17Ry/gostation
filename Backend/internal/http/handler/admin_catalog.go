package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/catalog"
)

// ── Catalogue produits ──────────────────────────────────────────────────────

type adminProductDTO struct {
	ID        int16     `json:"id"`
	Code      string    `json:"code"`
	Kind      string    `json:"kind"`
	Unit      string    `json:"unit"`
	SizeKg    *float64  `json:"sizeKg"`
	Label     string    `json:"label"`
	Active    bool      `json:"active"`
	SortOrder int16     `json:"sortOrder"`
	Stations  int32     `json:"stations"` // stations qui vendent le produit
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func toAdminProduct(p catalog.Product) adminProductDTO {
	return adminProductDTO{
		ID: p.ID, Code: p.Code, Kind: string(p.Kind), Unit: string(p.Unit), SizeKg: p.SizeKg, Label: p.LabelFr,
		Active: p.IsActive, SortOrder: p.SortOrder, Stations: p.Stations, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
}

func productPathID(r *http.Request) (int16, error) {
	n, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 16)
	if err != nil || n < 1 {
		return 0, apperr.BadRequest(apperr.CodeInvalidParameter, "Path parameter id must be a positive integer.")
	}
	return int16(n), nil
}

// Products liste le catalogue complet, désactivés compris (GET /admin/products?cursor&limit).
func (h *Admin) Products(w http.ResponseWriter, r *http.Request) error {
	q, err := strictQuery(r, "cursor", "limit")
	if err != nil {
		return err
	}
	limit, err := queryInt(q, "limit")
	if err != nil {
		return err
	}
	page, err := h.catalog.List(r.Context(), q.Get("cursor"), limit)
	if err != nil {
		return err
	}
	out := pageResponse[adminProductDTO]{Items: make([]adminProductDTO, 0, len(page.Items)), NextCursor: pageCursor(page.NextCursor)}
	for _, p := range page.Items {
		out.Items = append(out.Items, toAdminProduct(p))
	}
	h.rs.JSON(w, r, http.StatusOK, out)
	return nil
}

type createProductRequest struct {
	Kind      string   `json:"kind"`
	SizeKg    *float64 `json:"sizeKg"`
	Label     string   `json:"label"`
	SortOrder *int     `json:"sortOrder"`
	Active    *bool    `json:"active"`
}

func catalogActor(r *http.Request) catalog.Actor {
	uid, role := adminActor(r)
	return catalog.Actor{UserID: uid, Role: role}
}

// CreateProduct ajoute un produit (POST /admin/products).
func (h *Admin) CreateProduct(w http.ResponseWriter, r *http.Request) error {
	var req createProductRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	p, err := h.catalog.Create(r.Context(), catalogActor(r), catalog.CreateInput{
		Kind: req.Kind, SizeKg: req.SizeKg, Label: req.Label, SortOrder: req.SortOrder, Active: req.Active,
	})
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusCreated, toAdminProduct(p))
	return nil
}

// updateProductRequest accepte aussi les champs figés pour les refuser explicitement (422
// « immutable ») plutôt que comme des champs inconnus.
type updateProductRequest struct {
	Label     *string         `json:"label"`
	SortOrder *int            `json:"sortOrder"`
	Active    *bool           `json:"active"`
	Kind      json.RawMessage `json:"kind"`
	Unit      json.RawMessage `json:"unit"`
	SizeKg    json.RawMessage `json:"sizeKg"`
	Code      json.RawMessage `json:"code"`
}

// UpdateProduct modifie le libellé, l'ordre ou l'activation d'un produit (PATCH /admin/products/{id}).
func (h *Admin) UpdateProduct(w http.ResponseWriter, r *http.Request) error {
	id, err := productPathID(r)
	if err != nil {
		return err
	}
	var req updateProductRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	var fe []apperr.FieldError
	for name, v := range map[string]json.RawMessage{"kind": req.Kind, "unit": req.Unit, "sizeKg": req.SizeKg, "code": req.Code} {
		if v != nil {
			fe = append(fe, apperr.FieldError{Field: name, Code: "immutable", Message: "cannot be changed after creation"})
		}
	}
	if len(fe) > 0 {
		return apperr.Validation(fe...)
	}
	p, err := h.catalog.Update(r.Context(), catalogActor(r), id, catalog.UpdateInput{Label: req.Label, SortOrder: req.SortOrder, Active: req.Active})
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusOK, toAdminProduct(p))
	return nil
}
