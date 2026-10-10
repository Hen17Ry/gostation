// Package station regroupe la logique des stations. Étape 3 : statut pour le middleware
// RequireApprovedStation, lecture par le gérant, lecture du justificatif par un admin.
// La gestion complète (position, horaires, stocks) arrive à l'étape 4.
package station

import (
	"context"
	"fmt"
	"net/http"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/document"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Service expose les opérations sur les stations.
type Service struct {
	store *store.Store
	docs  *document.Service
	audit *audit.Logger
}

// NewService construit le service.
func NewService(st *store.Store, docs *document.Service, a *audit.Logger) *Service {
	return &Service{store: st, docs: docs, audit: a}
}

// ManagerStationStatus renvoie le statut de la station du gérant ("" s'il n'en a pas).
func (s *Service) ManagerStationStatus(ctx context.Context, managerID uuid.UUID) (string, error) {
	st, err := s.store.GetStationByManager(ctx, &managerID)
	if store.IsNotFound(err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("station: load manager station: %w", err)
	}
	return string(st.Status), nil
}

// ForManager renvoie la station du gérant.
func (s *Service) ForManager(ctx context.Context, managerID uuid.UUID) (dbgen.GetStationByManagerRow, error) {
	st, err := s.store.GetStationByManager(ctx, &managerID)
	if err != nil {
		return st, fmt.Errorf("station: load manager station: %w", store.Translate(err))
	}
	return st, nil
}

// Document déchiffre le justificatif d'une station pour un admin et journalise la lecture.
func (s *Service) Document(ctx context.Context, adminID, stationID uuid.UUID) ([]byte, string, error) {
	row, err := s.store.GetStationDocument(ctx, stationID)
	if err != nil {
		return nil, "", fmt.Errorf("station: load document metadata: %w", store.Translate(err))
	}
	if row.DocumentObjectKey == nil || row.DocumentMime == nil {
		return nil, "", apperr.New(http.StatusNotFound, apperr.CodeNotFound, "This station has no document.")
	}
	data, err := s.docs.Open(ctx, document.Stored{
		ObjectKey: *row.DocumentObjectKey, WrappedKey: row.DocumentWrappedKey,
		SHA256: row.DocumentSha256, MIME: *row.DocumentMime,
	})
	if err != nil {
		return nil, "", err
	}
	s.audit.Log(ctx, audit.Entry{
		ActorID: &adminID, ActorRole: string(dbgen.UserRoleAdmin),
		Action: audit.ActionDocumentViewed, EntityType: "station", EntityID: stationID.String(),
	})
	return data, *row.DocumentMime, nil
}
