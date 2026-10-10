package handler

import (
	"context"
	"fmt"
	"net/http"

	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// ProductLister est la partie du store utilisée par Products.
type ProductLister interface {
	ListActiveProducts(ctx context.Context) ([]dbgen.ListActiveProductsRow, error)
}

// Products expose le catalogue public.
type Products struct {
	rs    *respond.Responder
	store ProductLister
}

// NewProducts construit le handler du catalogue.
func NewProducts(rs *respond.Responder, s ProductLister) *Products {
	return &Products{rs: rs, store: s}
}

type productDTO struct {
	ID     int16    `json:"id"`
	Code   string   `json:"code"`
	Kind   string   `json:"kind"`
	Unit   string   `json:"unit"`
	SizeKg *float64 `json:"sizeKg"`
	Label  string   `json:"label"`
}

// List renvoie les produits actifs dans l'ordre d'affichage (GET /api/v1/products).
func (h *Products) List(w http.ResponseWriter, r *http.Request) error {
	rows, err := h.store.ListActiveProducts(r.Context())
	if err != nil {
		return fmt.Errorf("list active products: %w", store.Translate(err))
	}
	items := make([]productDTO, 0, len(rows))
	for _, p := range rows {
		items = append(items, productDTO{
			ID:     p.ID,
			Code:   p.Code,
			Kind:   string(p.Kind),
			Unit:   string(p.Unit),
			SizeKg: p.SizeKg,
			Label:  p.LabelFr,
		})
	}
	// Le catalogue change rarement : 5 min de cache client.
	w.Header().Set("Cache-Control", "public, max-age=300")
	h.rs.JSON(w, r, http.StatusOK, listResponse[productDTO]{Items: items})
	return nil
}
