// Package catalog gère le catalogue produits côté admin (étape 7) : création d'un produit (type et
// taille figés ensuite), modification du libellé, de l'ordre d'affichage et de l'activation. Aucune
// suppression : un produit désactivé disparaît de la recherche, du catalogue public et des choix du
// gérant, mais ses stocks et son historique restent. Chaque écriture invalide le cache de
// recherche du produit et passe au journal d'audit.
package catalog

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// CodeAlreadyExists : un produit de même type (et de même taille pour le gaz) existe déjà.
const CodeAlreadyExists = "product.already_exists"

// Bornes de saisie.
const (
	MinSizeKg     = 0.5
	MaxSizeKg     = 100
	MaxSortOrder  = 9999
	labelMinRunes = 2
	labelMaxRunes = 60
)

// CacheInvalidator invalide le cache de recherche (*searchcache.Invalidator).
type CacheInvalidator interface {
	Products(ctx context.Context, ids ...int16) error
}

// Actor identifie l'admin à l'origine d'une écriture.
type Actor struct {
	UserID uuid.UUID
	Role   string
}

// Service expose le catalogue admin.
type Service struct {
	store *store.Store
	cache CacheInvalidator
	audit *audit.Logger
	log   *slog.Logger
}

// NewService construit le service.
func NewService(st *store.Store, cache CacheInvalidator, a *audit.Logger, log *slog.Logger) *Service {
	return &Service{store: st, cache: cache, audit: a, log: log}
}

// Product est un produit du catalogue, vu par l'admin.
type Product = dbgen.ListProductsForAdminRow

// Page est une page du catalogue.
type Page struct {
	Items      []Product
	NextCursor string
}

func encodeCursor(sort, id int16) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(int(sort)) + "|" + strconv.Itoa(int(id))))
}

func decodeCursor(c string) (int16, int16, error) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return 0, 0, err
	}
	a, b, ok := strings.Cut(string(raw), "|")
	if !ok {
		return 0, 0, fmt.Errorf("malformed cursor")
	}
	sort, err := strconv.ParseInt(a, 10, 16)
	if err != nil {
		return 0, 0, err
	}
	id, err := strconv.ParseInt(b, 10, 16)
	return int16(sort), int16(id), err
}

// List renvoie le catalogue complet (désactivés compris), dans l'ordre d'affichage.
func (s *Service) List(ctx context.Context, cursor string, limit int) (Page, error) {
	if limit == 0 {
		limit = 100
	}
	if limit < 1 || limit > 100 {
		return Page{}, apperr.Validation(apperr.FieldError{Field: "limit", Code: "out_of_range", Message: "must be between 1 and 100"})
	}
	p := dbgen.ListProductsForAdminParams{PageSize: int32(limit + 1)} //nolint:gosec // ≤ 101
	if cursor != "" {
		sort, id, err := decodeCursor(cursor)
		if err != nil {
			return Page{}, apperr.BadRequest(apperr.CodeInvalidParameter, "Invalid cursor.")
		}
		p.CursorSort, p.CursorID = &sort, &id
	}
	rows, err := s.store.ListProductsForAdmin(ctx, p)
	if err != nil {
		return Page{}, fmt.Errorf("catalog: list: %w", err)
	}
	page := Page{Items: rows}
	if len(rows) > limit {
		page.Items = rows[:limit]
		last := page.Items[limit-1]
		page.NextCursor = encodeCursor(last.SortOrder, last.ID)
	}
	return page, nil
}

// Get renvoie un produit.
func (s *Service) Get(ctx context.Context, id int16) (Product, error) {
	r, err := s.store.GetProductForAdmin(ctx, id)
	if err != nil {
		return Product{}, fmt.Errorf("catalog: load: %w", store.Translate(err))
	}
	return Product(r), nil
}

// CreateInput est un nouveau produit.
type CreateInput struct {
	Kind      string
	SizeKg    *float64
	Label     string
	SortOrder *int
	Active    *bool
}

func label(field string, v string, f *[]apperr.FieldError) string {
	t := strings.TrimSpace(v)
	if n := utf8.RuneCountInString(t); n < labelMinRunes || n > labelMaxRunes {
		*f = append(*f, apperr.FieldError{Field: field, Code: "invalid_length", Message: fmt.Sprintf("must be %d to %d characters", labelMinRunes, labelMaxRunes)})
	}
	return t
}

func sortOrder(v *int, f *[]apperr.FieldError) *int16 {
	if v == nil {
		return nil
	}
	if *v < 0 || *v > MaxSortOrder {
		*f = append(*f, apperr.FieldError{Field: "sortOrder", Code: "out_of_range", Message: fmt.Sprintf("must be between 0 and %d", MaxSortOrder)})
		return nil
	}
	n := int16(*v) //nolint:gosec // borné ci-dessus
	return &n
}

// centesimal indique qu'une taille a au plus deux décimales (12.6 × 100 vaut 1259,9999… en
// flottant : tolérance d'un millionième).
func centesimal(v float64) bool {
	return math.Abs(v*100-math.Round(v*100)) < 1e-6
}

// productCode dérive le code stable du produit : lpg_12_5kg, petrol, diesel.
func productCode(kind string, size *float64) string {
	if size == nil {
		return kind
	}
	s := strconv.FormatFloat(*size, 'f', -1, 64)
	return kind + "_" + strings.ReplaceAll(s, ".", "_") + "kg"
}

// Create ajoute un produit. Le gaz se vend en bouteilles d'une taille donnée (0,5 à 100 kg, au
// centième) ; l'essence et le gasoil en litres, sans taille. Type, unité et taille sont figés.
func (s *Service) Create(ctx context.Context, a Actor, in CreateInput) (Product, error) {
	var f []apperr.FieldError
	p := dbgen.CreateProductParams{LabelFr: label("label", in.Label, &f), SortOrder: sortOrder(in.SortOrder, &f), IsActive: true}
	if in.Active != nil {
		p.IsActive = *in.Active
	}
	switch in.Kind {
	case string(dbgen.ProductKindLpg):
		p.Kind, p.Unit = dbgen.ProductKindLpg, dbgen.ProductUnitCylinder
		switch {
		case in.SizeKg == nil:
			f = append(f, apperr.FieldError{Field: "sizeKg", Code: "required", Message: "is required for lpg"})
		case *in.SizeKg < MinSizeKg || *in.SizeKg > MaxSizeKg || !centesimal(*in.SizeKg):
			f = append(f, apperr.FieldError{Field: "sizeKg", Code: "out_of_range", Message: "must be between 0.5 and 100 kg, with at most 2 decimals"})
		default:
			size := math.Round(*in.SizeKg*100) / 100
			p.SizeKg = &size
		}
	case string(dbgen.ProductKindPetrol), string(dbgen.ProductKindDiesel):
		p.Kind, p.Unit = dbgen.ProductKind(in.Kind), dbgen.ProductUnitLiter
		if in.SizeKg != nil {
			f = append(f, apperr.FieldError{Field: "sizeKg", Code: "not_allowed", Message: "fuels are sold by the liter, without a size"})
		}
	default:
		f = append(f, apperr.FieldError{Field: "kind", Code: "invalid", Message: "must be lpg, petrol or diesel"})
	}
	if len(f) > 0 {
		return Product{}, apperr.Validation(f...)
	}
	p.Code = productCode(in.Kind, p.SizeKg)
	id, err := s.store.CreateProduct(ctx, p)
	if apperr.HasCode(store.Translate(err), apperr.CodeConflict) { // même type et même taille, ou même code
		return Product{}, apperr.New(http.StatusConflict, CodeAlreadyExists, "A product of this kind and size already exists.")
	}
	if err != nil {
		return Product{}, fmt.Errorf("catalog: create: %w", err)
	}
	s.audit.Log(ctx, audit.Entry{
		ActorID: &a.UserID, ActorRole: a.Role, Action: audit.ActionProductCreated, EntityType: "product",
		EntityID: strconv.Itoa(int(id)), Metadata: map[string]any{"code": p.Code, "label": p.LabelFr, "active": p.IsActive},
	})
	s.invalidate(ctx, id)
	return s.Get(ctx, id)
}

// UpdateInput modifie un produit : nil = inchangé.
type UpdateInput struct {
	Label     *string
	SortOrder *int
	Active    *bool
}

// Update modifie le libellé, l'ordre d'affichage ou l'activation d'un produit.
func (s *Service) Update(ctx context.Context, a Actor, id int16, in UpdateInput) (Product, error) {
	var f []apperr.FieldError
	p := dbgen.UpdateProductParams{ID: id, SortOrder: sortOrder(in.SortOrder, &f), IsActive: in.Active}
	if in.Label != nil {
		l := label("label", *in.Label, &f)
		p.LabelFr = &l
	}
	if in.Label == nil && in.SortOrder == nil && in.Active == nil {
		f = append(f, apperr.FieldError{Field: "label", Code: "required", Message: "at least one of label, sortOrder or active must be provided"})
	}
	if len(f) > 0 {
		return Product{}, apperr.Validation(f...)
	}
	before, err := s.Get(ctx, id)
	if err != nil {
		return Product{}, err
	}
	if _, err := s.store.UpdateProduct(ctx, p); err != nil {
		return Product{}, fmt.Errorf("catalog: update: %w", err)
	}
	after, err := s.Get(ctx, id)
	if err != nil {
		return Product{}, err
	}
	changes := map[string]any{}
	if before.LabelFr != after.LabelFr {
		changes["label"] = map[string]string{"from": before.LabelFr, "to": after.LabelFr}
	}
	if before.SortOrder != after.SortOrder {
		changes["sortOrder"] = map[string]int16{"from": before.SortOrder, "to": after.SortOrder}
	}
	if before.IsActive != after.IsActive {
		changes["active"] = map[string]bool{"from": before.IsActive, "to": after.IsActive}
	}
	s.audit.Log(ctx, audit.Entry{
		ActorID: &a.UserID, ActorRole: a.Role, Action: audit.ActionProductUpdated, EntityType: "product",
		EntityID: strconv.Itoa(int(id)), Metadata: map[string]any{"code": after.Code, "changes": changes},
	})
	s.invalidate(ctx, id)
	return after, nil
}

// invalidate incrémente la génération du produit après l'écriture ; un échec est journalisé (le
// TTL de 60 s borne le décalage).
func (s *Service) invalidate(ctx context.Context, id int16) {
	if err := s.cache.Products(ctx, id); err != nil {
		s.log.WarnContext(ctx, "catalog: search cache invalidation failed", slog.Any("err", err))
	}
}
