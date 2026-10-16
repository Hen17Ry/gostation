package privacy

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/platform/storage"
	"gostation/backend/internal/pseudonym"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// stationDetachedReason : motif posé sur la station d'un gérant dont le compte est supprimé (lu par
// l'admin, en français comme les motifs saisis à la main).
const stationDetachedReason = "Compte du gérant supprimé."

// DeleteMyAccount supprime le compte de la personne connectée, après confirmation par son mot de
// passe (DELETE /me). La suppression est tracée par une demande close (preuve de conformité).
func (s *Service) DeleteMyAccount(ctx context.Context, a Actor, password string) error {
	if a.Role == string(dbgen.UserRoleAdmin) {
		return apperr.New(http.StatusForbidden, apperr.CodeForbidden, "Admin accounts are removed with the admin CLI.")
	}
	if err := s.Passwords.VerifyPassword(ctx, a.UserID, password); err != nil {
		return err
	}
	now := s.now()
	note := "Compte supprimé depuis l'application."
	if _, err := s.Store.InsertDataRequest(ctx, dbgen.InsertDataRequestParams{
		UserID: &a.UserID, Type: dbgen.DataRequestTypeDeletion, Status: dbgen.DataRequestStatusCompleted,
		Source: dbgen.DataRequestSourceApp, DueAt: now, VerifiedAt: &now, ResponseNote: &note, CompletedAt: &now,
	}); err != nil {
		return fmt.Errorf("privacy: record deletion: %w", err)
	}
	return s.erase(ctx, a.UserID, mail.DeletedBySelf, &a)
}

// ExecuteDeletion supprime le compte visé par une demande de suppression confirmée (admin), puis
// clôt la demande (la personne a reçu l'email de confirmation de la suppression).
func (s *Service) ExecuteDeletion(ctx context.Context, admin Actor, id uuid.UUID, version int32, response string) (AdminRequest, error) {
	r, err := s.load(ctx, id)
	if err != nil {
		return AdminRequest{}, err
	}
	if err := s.ready(r); err != nil {
		return AdminRequest{}, err
	}
	if r.Type != dbgen.DataRequestTypeDeletion {
		return AdminRequest{}, conflict(CodeWrongType, "Only a deletion request can delete an account.")
	}
	if r.UserID == nil || r.UserStatus == nil || *r.UserStatus == dbgen.UserStatusPendingDeletion {
		return AdminRequest{}, conflict(CodeAccountDeleted, "The account of this request is already deleted.")
	}
	if r.Version != version {
		return AdminRequest{}, versionConflict()
	}
	if err := s.erase(ctx, *r.UserID, mail.DeletedOnRequest, &admin); err != nil {
		return AdminRequest{}, err
	}
	if response = strings.TrimSpace(response); response == "" {
		response = "Votre compte et vos données personnelles ont été supprimés."
	}
	if err := s.close(ctx, admin, id, &version, dbgen.DataRequestStatusCompleted, response); err != nil {
		return AdminRequest{}, err
	}
	return s.Get(ctx, id)
}

// EraseInactive supprime un compte inactif (purge de conservation, sans auteur).
func (s *Service) EraseInactive(ctx context.Context, uid uuid.UUID) error {
	return s.erase(ctx, uid, mail.DeletedForInactivity, nil)
}

// erase anonymise un compte : plus aucune donnée personnelle dans users, appareils, favoris,
// notifications, préférences et alertes supprimés, signalements pseudonymisés, copies supprimées,
// sessions révoquées. Station d'un gérant : approuvée ou en attente → suspendue (retirée de la
// recherche et de la file de revue), lien avec le compte rompu ; le justificatif suit sa durée de
// conservation.
// Idempotent : un compte déjà supprimé est laissé tel quel.
func (s *Service) erase(ctx context.Context, uid uuid.UUID, cause string, by *Actor) error {
	u, err := s.Store.GetUserContact(ctx, uid)
	if err != nil {
		return fmt.Errorf("privacy: load account: %w", store.Translate(err))
	}
	if u.Role == dbgen.UserRoleAdmin {
		return conflict(CodeAdminAccount, "Admin accounts are removed with the admin CLI.")
	}
	if u.Status == dbgen.UserStatusPendingDeletion {
		return nil
	}
	exports, err := s.Store.ListUserPersonalExports(ctx, uid)
	if err != nil {
		return fmt.Errorf("privacy: list exports: %w", err)
	}
	now := s.now()
	var stations []dbgen.DetachManagedStationRow
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.AnonymizeUser(ctx, dbgen.AnonymizeUserParams{
			ID: uid, AnonymizedEmail: "deleted+" + uid.String() + "@anonymized.invalid",
		}); err != nil {
			return err
		}
		for _, del := range []func(context.Context, uuid.UUID) error{
			q.DeleteUserDeviceTokens, q.DeleteUserFavorites, q.DeleteUserNotifications,
			q.DeleteUserNotificationOptOuts, q.DeleteUserBackInStockAlerts,
		} {
			if err := del(ctx, uid); err != nil {
				return err
			}
		}
		if _, err := q.PseudonymizeUserReports(ctx, dbgen.PseudonymizeUserReportsParams{
			UserID: &uid, Pseudonym: ptr(pseudonym.Of(s.PseudonymKey, uid)), Now: &now,
		}); err != nil {
			return err
		}
		for _, e := range exports {
			if err := q.DeletePersonalExport(ctx, e.ID); err != nil {
				return err
			}
		}
		if u.Role == dbgen.UserRoleManager {
			stations, err = q.DetachManagedStation(ctx, dbgen.DetachManagedStationParams{
				UserID: &uid, Reason: ptr(stationDetachedReason), Now: &now,
			})
			return err
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("privacy: erase account: %w", err)
	}
	for _, e := range exports {
		if e.ObjectKey != nil {
			if err := s.Storage.Delete(ctx, *e.ObjectKey); err != nil && !errors.Is(err, storage.ErrNotFound) {
				s.Log.ErrorContext(ctx, "privacy: delete export file", slog.String("export_id", e.ID.String()), slog.Any("err", err))
			}
		}
	}
	if err := s.Sessions.RevokeAll(ctx, uid, ""); err != nil {
		return err
	}
	if len(stations) > 0 {
		if err := s.Cache.All(ctx); err != nil {
			s.Log.ErrorContext(ctx, "privacy: invalidate search cache", slog.Any("err", err))
		}
	}
	entry := audit.Entry{
		Action: audit.ActionAccountDeleted, EntityType: "user", EntityID: uid.String(),
		Metadata: map[string]any{"cause": cause, "stations": len(stations)},
	}
	if by != nil {
		entry.ActorID, entry.ActorRole = &by.UserID, by.Role
	}
	s.Audit.Log(ctx, entry)
	m, err := s.Templates.AccountDeleted(u.Email, u.FirstName, cause)
	s.sendMail(ctx, "account_deleted", m, err)
	return nil
}
