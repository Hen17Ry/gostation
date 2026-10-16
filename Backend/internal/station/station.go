// Package station regroupe la logique des stations : espace gérant (profil, position, horaires,
// fermetures, produits vendus, stocks), validation admin et lecture des justificatifs.
//
// Toute écriture passe par une transaction qui commence par BumpStationVersion : verrouillage
// optimiste (412 si la version attendue est périmée) et verrou de ligne pour la suite. Le cache
// de recherche est invalidé après le commit.
package station

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/document"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Statuts d'une station (enum station_status).
const (
	StatusPending   = string(dbgen.StationStatusPending)
	StatusApproved  = string(dbgen.StationStatusApproved)
	StatusRejected  = string(dbgen.StationStatusRejected)
	StatusSuspended = string(dbgen.StationStatusSuspended)
)

// Codes d'erreur stables du domaine station (docs/ARCHITECTURE.md §5).
const (
	CodeInvalidTransition      = "station.invalid_status_transition"
	CodeManagerEmailUnverified = "station.manager_email_unverified"
	CodeOutsideCountry         = "station.location_outside_country"
	CodeClosureExists          = "station.closure_exists"
	CodeNoProductsSold         = "station.no_products_sold"
)

// Config regroupe les réglages du service.
type Config struct {
	Timezone     *time.Location
	MaxCylinders int
	MaxLiters    int
	StaleAfter   time.Duration
	ExpiredAfter time.Duration
}

// CacheInvalidator invalide le cache de recherche (*searchcache.Invalidator).
type CacheInvalidator interface {
	Products(ctx context.Context, ids ...int16) error
	All(ctx context.Context) error
}

// DecisionNotifier prévient le gérant d'une décision de l'admin par push et dans sa boîte de
// réception (*notification.Service, étape 9C).
type DecisionNotifier interface {
	NotifyStationDecision(ctx context.Context, managerID, stationID uuid.UUID, stationName, decision string)
}

// RestockNotifier déclenche les alertes « de retour en stock » des favoris (*jobs.Client).
type RestockNotifier interface {
	EnqueueBackInStock(ctx context.Context, stationID uuid.UUID, productIDs []int16) error
}

// Deps regroupe les dépendances injectées.
type Deps struct {
	Store     *store.Store
	Documents *document.Service
	Audit     *audit.Logger
	Cache     CacheInvalidator
	Mailer    mail.Mailer
	Templates *mail.Renderer
	Restock   RestockNotifier
	Decisions DecisionNotifier // facultatif (nil : email seulement)
	Log       *slog.Logger
}

// Service expose les opérations sur les stations.
type Service struct {
	Deps
	cfg Config
	now func() time.Time
}

// NewService construit le service.
func NewService(cfg Config, d Deps) *Service {
	return &Service{Deps: d, cfg: cfg, now: time.Now}
}

// Timezone renvoie le nom du fuseau des horaires (Africa/Porto-Novo).
func (s *Service) Timezone() string { return s.cfg.Timezone.String() }

// ETag renvoie l'ETag d'une version de station ("v{version}") : en-tête des lectures, If-Match
// des écritures, et donnée des rappels (action « Rien n'a changé » sans ouvrir l'app).
func ETag(version int32) string { return `"v` + strconv.Itoa(int(version)) + `"` }

// Actor identifie l'utilisateur à l'origine d'une écriture (gérant ou admin).
type Actor struct {
	UserID uuid.UUID
	Role   string
}

func errVersionConflict() *apperr.Error {
	return apperr.New(http.StatusPreconditionFailed, apperr.CodeVersionConflict,
		"The station was modified meanwhile: reload it and try again.")
}

func errTransition(from, action string) *apperr.Error {
	return apperr.New(http.StatusConflict, CodeInvalidTransition,
		fmt.Sprintf("Cannot %s a station whose status is %s.", action, from)).WithMeta("stationStatus", from)
}

// bump applique le verrouillage optimiste dans la transaction et renvoie la nouvelle version.
func bump(ctx context.Context, q *dbgen.Queries, stationID uuid.UUID, expected int32) (int32, error) {
	v, err := q.BumpStationVersion(ctx, dbgen.BumpStationVersionParams{ID: stationID, ExpectedVersion: expected})
	if store.IsNotFound(err) {
		return 0, errVersionConflict()
	}
	if err != nil {
		return 0, fmt.Errorf("station: bump version: %w", err)
	}
	return v, nil
}

// managerStation renvoie la station du gérant (404 s'il n'en a pas).
func (s *Service) managerStation(ctx context.Context, q *dbgen.Queries, managerID uuid.UUID) (dbgen.GetStationByManagerRow, error) {
	st, err := q.GetStationByManager(ctx, &managerID)
	if err != nil {
		return st, fmt.Errorf("station: load manager station: %w", store.Translate(err))
	}
	return st, nil
}

// invalidate applique l'invalidation du cache après commit ; un échec n'annule pas l'écriture
// (le TTL de 60 s borne le décalage) mais il est journalisé.
func (s *Service) invalidate(ctx context.Context, all bool, products ...int16) {
	var err error
	if all {
		err = s.Cache.All(ctx)
	} else {
		err = s.Cache.Products(ctx, products...)
	}
	if err != nil {
		s.Log.WarnContext(ctx, "station: search cache invalidation failed", slog.Any("err", err))
	}
}

func (s *Service) audit(ctx context.Context, a Actor, action string, stationID uuid.UUID, meta map[string]any) {
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &a.UserID, ActorRole: a.Role, Action: action,
		EntityType: "station", EntityID: stationID.String(), Metadata: meta,
	})
}

// notify envoie au gérant un email de statut ; un échec est journalisé, jamais renvoyé.
func (s *Service) notify(ctx context.Context, stationID uuid.UUID, change mail.StationStatusChange, reason string) {
	contact, err := s.Store.GetStationContact(ctx, stationID)
	if err == nil {
		var m mail.Message
		if m, err = s.Templates.StationStatus(contact.Email, contact.FirstName, contact.Name, change, reason); err == nil {
			err = s.Mailer.Send(ctx, m)
		}
	}
	if err != nil {
		s.Log.ErrorContext(ctx, "station: status email", slog.String("change", string(change)), slog.Any("err", err))
	}
}

// pushDecision envoie la décision de l'admin au gérant (push et boîte de réception), en plus de
// l'email ; un échec est journalisé, jamais renvoyé.
func (s *Service) pushDecision(ctx context.Context, stationID uuid.UUID, decision string) {
	if s.Decisions == nil {
		return
	}
	contact, err := s.Store.GetStationContact(ctx, stationID)
	if err != nil {
		s.Log.ErrorContext(ctx, "station: decision push", slog.String("decision", decision), slog.Any("err", err))
		return
	}
	s.Decisions.NotifyStationDecision(ctx, contact.ManagerID, stationID, contact.Name, decision)
}

// ManagerStationStatus renvoie le statut de la station du gérant ("" s'il n'en a pas).
func (s *Service) ManagerStationStatus(ctx context.Context, managerID uuid.UUID) (string, error) {
	st, err := s.Store.GetStationByManager(ctx, &managerID)
	if store.IsNotFound(err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("station: load manager station: %w", err)
	}
	return string(st.Status), nil
}

// LocationRequest est une demande de déplacement en attente.
type LocationRequest struct {
	ID              uuid.UUID
	Lat, Lng        float64
	DistanceM       int32
	DeviceDistanceM *int32
	DeviceAccuracyM *int32
	CreatedAt       time.Time
}

func (s *Service) pendingMove(ctx context.Context, q *dbgen.Queries, stationID uuid.UUID) (*LocationRequest, error) {
	r, err := q.GetPendingLocationRequest(ctx, stationID)
	if store.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("station: load pending move: %w", err)
	}
	lr := &LocationRequest{
		ID: r.ID, DistanceM: r.DistanceM, DeviceDistanceM: r.DeviceDistanceM,
		DeviceAccuracyM: r.DeviceAccuracyM, CreatedAt: r.CreatedAt,
	}
	if r.Lat != nil && r.Lng != nil {
		lr.Lat, lr.Lng = *r.Lat, *r.Lng
	}
	return lr, nil
}

// Éléments de configuration manquants pour apparaître dans la recherche.
const (
	MissingApproval     = "approval"
	MissingLocation     = "location"
	MissingOpeningHours = "opening_hours"
	MissingProducts     = "products"
	MissingStock        = "stock" // aucun produit vendu en quantité > 0 avec un stock de moins de 24 h
)

// Setup est la checklist de configuration de la station.
type Setup struct {
	Location     bool
	OpeningHours bool
	Products     bool
	Stocks       bool
	Missing      []string
}

// Searchable indique que la station remplit toutes les conditions de la recherche.
func (s Setup) Searchable() bool { return len(s.Missing) == 0 }

// ManagerStation est la vue gérant d'une station.
type ManagerStation struct {
	dbgen.GetStationByManagerRow
	PendingMove *LocationRequest
	Setup       Setup
}

// setup calcule la checklist (l'ouverture à l'instant présent n'en fait pas partie).
func (s *Service) setup(ctx context.Context, st dbgen.GetStationByManagerRow) (Setup, error) {
	hours, err := s.Store.ListOpeningHours(ctx, st.ID)
	if err != nil {
		return Setup{}, fmt.Errorf("station: setup hours: %w", err)
	}
	products, err := s.Store.ListStationProducts(ctx, st.ID)
	if err != nil {
		return Setup{}, fmt.Errorf("station: setup products: %w", err)
	}
	out := Setup{Location: st.Lat != nil && st.Lng != nil, OpeningHours: len(hours) > 0}
	for _, p := range products {
		if !p.Sold {
			continue
		}
		out.Products = true
		if p.Quantity != nil && *p.Quantity > 0 && p.UpdatedAt != nil && p.LastConfirmedAt != nil {
			fresh := *p.UpdatedAt
			if p.LastConfirmedAt.After(fresh) {
				fresh = *p.LastConfirmedAt
			}
			if s.Freshness(fresh) != FreshnessExpired {
				out.Stocks = true
			}
		}
	}
	out.Missing = []string{}
	if string(st.Status) != StatusApproved {
		out.Missing = append(out.Missing, MissingApproval)
	}
	for _, m := range []struct {
		ok   bool
		code string
	}{{out.Location, MissingLocation}, {out.OpeningHours, MissingOpeningHours}, {out.Products, MissingProducts}, {out.Stocks, MissingStock}} {
		if !m.ok {
			out.Missing = append(out.Missing, m.code)
		}
	}
	return out, nil
}

// ForManager renvoie la station du gérant et sa demande de déplacement en attente.
func (s *Service) ForManager(ctx context.Context, managerID uuid.UUID) (ManagerStation, error) {
	st, err := s.managerStation(ctx, s.Store.Queries, managerID)
	if err != nil {
		return ManagerStation{}, err
	}
	move, err := s.pendingMove(ctx, s.Store.Queries, st.ID)
	if err != nil {
		return ManagerStation{}, err
	}
	setup, err := s.setup(ctx, st)
	if err != nil {
		return ManagerStation{}, err
	}
	return ManagerStation{GetStationByManagerRow: st, PendingMove: move, Setup: setup}, nil
}

// Document déchiffre le justificatif d'une station pour un admin et journalise la lecture.
func (s *Service) Document(ctx context.Context, adminID, stationID uuid.UUID) ([]byte, string, error) {
	row, err := s.Store.GetStationDocument(ctx, stationID)
	if err != nil {
		return nil, "", fmt.Errorf("station: load document metadata: %w", store.Translate(err))
	}
	if row.DocumentObjectKey == nil || row.DocumentMime == nil {
		return nil, "", apperr.New(http.StatusNotFound, apperr.CodeNotFound, "This station has no document.")
	}
	data, err := s.Documents.Open(ctx, document.Stored{
		ObjectKey: *row.DocumentObjectKey, WrappedKey: row.DocumentWrappedKey,
		SHA256: row.DocumentSha256, MIME: *row.DocumentMime,
	})
	if err != nil {
		return nil, "", err
	}
	s.audit(ctx, Actor{UserID: adminID, Role: string(dbgen.UserRoleAdmin)}, audit.ActionDocumentViewed, stationID, nil)
	return data, *row.DocumentMime, nil
}
