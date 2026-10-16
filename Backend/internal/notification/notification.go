// Package notification gère les notifications des comptes vérifiés : appareils push (liés à leur
// session), boîte de réception (30 jours), préférences par type (opt-out) et livraison des push
// par le worker (lots Expo, reçus, nettoyage des tokens morts).
//
// Une notification est d'abord écrite dans la boîte de réception (dans la transaction de
// l'appelant, opt-out respecté), puis son push est mis en file après le commit.
package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/jobs"
	"gostation/backend/internal/push"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Type est un type de notification (enum notification_type).
type Type string

// Types de notification.
const (
	TypeStockReminder   Type = "stock_reminder"   // gérant : stocks à mettre à jour
	TypeStationReported Type = "station_reported" // gérant : seuil de signalements atteint
	TypeBackInStock     Type = "back_in_stock"    // utilisateur : produit d'un favori de retour en stock
	// TypeStationDecision : gérant, décision de l'admin sur sa station (étape 9C). Toujours envoyé :
	// absent des préférences, comme l'email qui l'accompagne.
	TypeStationDecision Type = "station_decision"
)

// Décisions de l'admin (donnée decision de station_decision).
const (
	DecisionApproved     = "approved"
	DecisionRejected     = "rejected"
	DecisionSuspended    = "suspended"
	DecisionReinstated   = "reinstated"
	DecisionMoveApproved = "move_approved"
	DecisionMoveRejected = "move_rejected"
)

// Niveaux d'un signalement collectif (donnée level de station_reported).
const (
	LevelFlagged  = "flagged"  // 3 auteurs : badge « signalé »
	LevelExcluded = "excluded" // 5 auteurs : exclu de la recherche
)

// TypesFor renvoie les types qui concernent un rôle (préférences proposées).
func TypesFor(role string) []Type {
	switch role {
	case string(dbgen.UserRoleManager):
		return []Type{TypeStockReminder, TypeStationReported, TypeBackInStock}
	case string(dbgen.UserRoleUser):
		return []Type{TypeBackInStock}
	default:
		return nil
	}
}

// PushQueue met en file les tâches de livraison (*jobs.Client).
type PushQueue interface {
	EnqueuePush(ctx context.Context, ids []uuid.UUID) error
	EnqueueReceipts(ctx context.Context, tickets []jobs.TicketRef) error
}

// SessionChecker vérifie que les sessions des appareils existent encore (*auth.SessionStore).
type SessionChecker interface {
	Alive(ctx context.Context, sids []string) (map[string]bool, error)
}

// Deps regroupe les dépendances injectées.
type Deps struct {
	Store    *store.Store
	Queue    PushQueue
	Pusher   push.Pusher
	Sessions SessionChecker
	Log      *slog.Logger
}

// Service expose les notifications.
type Service struct {
	Deps
}

// NewService construit le service.
func NewService(d Deps) *Service { return &Service{Deps: d} }

// ── Création et mise en file ────────────────────────────────────────────────

// Create écrit une notification dans la boîte de réception, dans la transaction q de l'appelant.
// created vaut false si l'utilisateur a désactivé ce type ou si son compte n'est plus actif.
// data ne contient jamais de position ni d'identité d'un tiers.
func (s *Service) Create(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, t Type, data map[string]any) (uuid.UUID, bool, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("notification: encode data: %w", err)
	}
	id, err := q.InsertNotification(ctx, dbgen.InsertNotificationParams{UserID: userID, Type: dbgen.NotificationType(t), Data: raw})
	if store.IsNotFound(err) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("notification: insert: %w", err)
	}
	return id, true, nil
}

// Dispatch met en file les push des notifications créées (après le commit). Un échec est
// journalisé : la notification reste dans la boîte de réception.
func (s *Service) Dispatch(ctx context.Context, ids []uuid.UUID) {
	if len(ids) == 0 {
		return
	}
	if err := s.Queue.EnqueuePush(ctx, ids); err != nil {
		s.Log.ErrorContext(ctx, "notification: push not queued", slog.Int("notifications", len(ids)), slog.Any("err", err))
	}
}

// ── Appareils ───────────────────────────────────────────────────────────────

// Langues des push (rendus côté serveur : le système les affiche sans l'app).
const (
	LangFR = "fr"
	LangEN = "en"
)

// expoToken reconnaît un token Expo (ExponentPushToken[…] ou ExpoPushToken[…]).
var expoToken = regexp.MustCompile(`^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$`)

// DeviceInput est l'enregistrement d'un appareil (POST /me/devices).
type DeviceInput struct {
	Token      string
	Platform   string
	InstallID  uuid.UUID
	Language   string
	AppVersion *string
}

// Device est un appareil enregistré (le token n'est jamais renvoyé).
type Device struct {
	ID         uuid.UUID
	Platform   string
	Language   string
	AppVersion *string
	CreatedAt  time.Time
	LastSeenAt time.Time
}

// RegisterDevice enregistre (ou rafraîchit) l'appareil de l'installation, lié à la session
// courante : la révocation de cette session supprimera le token.
func (s *Service) RegisterDevice(ctx context.Context, userID uuid.UUID, sessionID string, in DeviceInput) (Device, error) {
	var fields []apperr.FieldError
	in.Token = strings.TrimSpace(in.Token)
	if !expoToken.MatchString(in.Token) {
		fields = append(fields, apperr.FieldError{Field: "token", Code: "invalid", Message: "must be an Expo push token"})
	}
	if in.Platform != string(dbgen.DevicePlatformIos) && in.Platform != string(dbgen.DevicePlatformAndroid) {
		fields = append(fields, apperr.FieldError{Field: "platform", Code: "invalid", Message: "must be ios or android"})
	}
	if in.InstallID == uuid.Nil {
		fields = append(fields, apperr.FieldError{Field: "installId", Code: "required", Message: "must be the installation UUID"})
	}
	if in.Language == "" {
		in.Language = LangFR
	}
	if in.Language != LangFR && in.Language != LangEN {
		fields = append(fields, apperr.FieldError{Field: "language", Code: "invalid", Message: "must be fr or en"})
	}
	if in.AppVersion != nil {
		v := strings.TrimSpace(*in.AppVersion)
		switch {
		case v == "":
			in.AppVersion = nil
		case utf8.RuneCountInString(v) > 32:
			fields = append(fields, apperr.FieldError{Field: "appVersion", Code: "too_long", Message: "must be at most 32 characters"})
		default:
			in.AppVersion = &v
		}
	}
	if len(fields) > 0 {
		return Device{}, apperr.Validation(fields...)
	}
	var d Device
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := q.DeleteDeviceTokenElsewhere(ctx, dbgen.DeleteDeviceTokenElsewhereParams{Token: in.Token, InstallID: in.InstallID}); err != nil {
			return err
		}
		row, err := q.UpsertDevice(ctx, dbgen.UpsertDeviceParams{
			UserID: userID, Token: in.Token, Platform: dbgen.DevicePlatform(in.Platform), AppVersion: in.AppVersion,
			SessionID: sessionID, InstallID: in.InstallID, Language: in.Language,
		})
		if err != nil {
			return err
		}
		d = Device{
			ID: row.ID, Platform: string(row.Platform), Language: row.Language, AppVersion: row.AppVersion,
			CreatedAt: row.CreatedAt, LastSeenAt: row.LastSeenAt,
		}
		return nil
	})
	if err != nil {
		return Device{}, fmt.Errorf("notification: register device: %w", err)
	}
	return d, nil
}

// UnregisterDevice supprime un appareil du compte (404 pour celui d'un autre compte).
func (s *Service) UnregisterDevice(ctx context.Context, userID, id uuid.UUID) error {
	n, err := s.Store.DeleteDevice(ctx, dbgen.DeleteDeviceParams{ID: id, UserID: userID})
	if err != nil {
		return fmt.Errorf("notification: unregister device: %w", err)
	}
	if n == 0 {
		return apperr.NotFound("Device not found.")
	}
	return nil
}

// NotifyStationDecision écrit la décision de l'admin dans la boîte de réception du gérant et met
// son push en file, après la décision (qui est déjà validée). Un échec est journalisé : l'email
// de décision part de son côté.
func (s *Service) NotifyStationDecision(ctx context.Context, managerID, stationID uuid.UUID, stationName, decision string) {
	data := map[string]any{"decision": decision, "stationId": stationID.String(), "stationName": stationName}
	var id uuid.UUID
	var created bool
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		var err error
		id, created, err = s.Create(ctx, q, managerID, TypeStationDecision, data)
		return err
	})
	if err != nil {
		s.Log.ErrorContext(ctx, "notification: station decision not recorded", slog.String("decision", decision), slog.Any("err", err))
		return
	}
	if created {
		s.Dispatch(ctx, []uuid.UUID{id})
	}
}

// SessionRevoked supprime les appareils d'une session révoquée (crochet de auth.SessionStore).
func (s *Service) SessionRevoked(ctx context.Context, sid string) {
	if _, err := s.Store.DeleteDevicesBySession(ctx, sid); err != nil {
		s.Log.ErrorContext(ctx, "notification: devices of a revoked session not deleted", slog.Any("err", err))
	}
}

// ── Boîte de réception ──────────────────────────────────────────────────────

// Item est une notification de la boîte de réception. Data est le JSON des paramètres
// d'affichage : l'app compose le texte d'après le type.
type Item struct {
	ID        uuid.UUID
	Type      string
	Data      json.RawMessage
	CreatedAt time.Time
	ReadAt    *time.Time
}

// InboxPage est une page de la boîte de réception.
type InboxPage struct {
	Items      []Item
	NextCursor string
	Unread     int64
}

// Inbox renvoie une page de la boîte de réception, la plus récente d'abord.
func (s *Service) Inbox(ctx context.Context, userID uuid.UUID, cursor string, limit int) (InboxPage, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		return InboxPage{}, apperr.Validation(apperr.FieldError{Field: "limit", Code: "out_of_range", Message: "must be between 1 and 100"})
	}
	p := dbgen.ListNotificationsParams{UserID: userID, PageSize: int32(limit + 1)} //nolint:gosec // ≤ 101
	if cursor != "" {
		id, err := uuid.Parse(cursor)
		if err != nil {
			return InboxPage{}, apperr.BadRequest(apperr.CodeInvalidParameter, "Invalid cursor.")
		}
		p.Cursor = &id
	}
	rows, err := s.Store.ListNotifications(ctx, p)
	if err != nil {
		return InboxPage{}, fmt.Errorf("notification: inbox: %w", err)
	}
	unread, err := s.Store.CountUnreadNotifications(ctx, userID)
	if err != nil {
		return InboxPage{}, fmt.Errorf("notification: unread count: %w", err)
	}
	page := InboxPage{Unread: unread, Items: make([]Item, 0, min(len(rows), limit))}
	for i, r := range rows {
		if i == limit {
			page.NextCursor = rows[limit-1].ID.String()
			break
		}
		page.Items = append(page.Items, Item{ID: r.ID, Type: string(r.Type), Data: r.Data, CreatedAt: r.CreatedAt, ReadAt: r.ReadAt})
	}
	return page, nil
}

// MarkRead marque des notifications comme lues (ids, ou toutes) et renvoie le nombre de non lues.
func (s *Service) MarkRead(ctx context.Context, userID uuid.UUID, ids []uuid.UUID, all bool) (int64, error) {
	switch {
	case all && len(ids) > 0:
		return 0, apperr.Validation(apperr.FieldError{Field: "ids", Code: "conflict", Message: "must be empty when all is true"})
	case !all && len(ids) == 0:
		return 0, apperr.Validation(apperr.FieldError{Field: "ids", Code: "required", Message: "give ids or set all to true"})
	case len(ids) > 100:
		return 0, apperr.Validation(apperr.FieldError{Field: "ids", Code: "too_many", Message: "at most 100 ids"})
	}
	if ids == nil {
		ids = []uuid.UUID{}
	}
	if _, err := s.Store.MarkNotificationsRead(ctx, dbgen.MarkNotificationsReadParams{UserID: userID, AllUnread: all, Ids: ids}); err != nil {
		return 0, fmt.Errorf("notification: mark read: %w", err)
	}
	unread, err := s.Store.CountUnreadNotifications(ctx, userID)
	if err != nil {
		return 0, fmt.Errorf("notification: unread count: %w", err)
	}
	return unread, nil
}

// ── Préférences (opt-out) ───────────────────────────────────────────────────

// Setting est l'état d'un type de notification pour le compte.
type Setting struct {
	Type    Type
	Enabled bool
}

// Settings renvoie les préférences des types qui concernent le rôle (tous activés par défaut).
func (s *Service) Settings(ctx context.Context, userID uuid.UUID, role string) ([]Setting, error) {
	off, err := s.Store.ListNotificationOptOuts(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("notification: settings: %w", err)
	}
	types := TypesFor(role)
	out := make([]Setting, 0, len(types))
	for _, t := range types {
		out = append(out, Setting{Type: t, Enabled: !slices.Contains(off, dbgen.NotificationType(t))})
	}
	return out, nil
}

// UpdateSettings applique des préférences (types absents : inchangés).
func (s *Service) UpdateSettings(ctx context.Context, userID uuid.UUID, role string, changes []Setting) ([]Setting, error) {
	allowed := TypesFor(role)
	var fields []apperr.FieldError
	seen := map[Type]bool{}
	for i, c := range changes {
		switch {
		case !slices.Contains(allowed, c.Type):
			fields = append(fields, apperr.FieldError{Field: fmt.Sprintf("settings[%d].type", i), Code: "invalid", Message: "is not a notification type of this account"})
		case seen[c.Type]:
			fields = append(fields, apperr.FieldError{Field: fmt.Sprintf("settings[%d].type", i), Code: "duplicate", Message: "each type must appear once"})
		}
		seen[c.Type] = true
	}
	if len(fields) > 0 {
		return nil, apperr.Validation(fields...)
	}
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		for _, c := range changes {
			var err error
			if c.Enabled {
				err = q.RemoveNotificationOptOut(ctx, dbgen.RemoveNotificationOptOutParams{UserID: userID, Type: dbgen.NotificationType(c.Type)})
			} else {
				err = q.AddNotificationOptOut(ctx, dbgen.AddNotificationOptOutParams{UserID: userID, Type: dbgen.NotificationType(c.Type)})
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("notification: update settings: %w", err)
	}
	return s.Settings(ctx, userID, role)
}

// errNotAllowed est renvoyée aux rôles sans notifications (admin).
func errNotAllowed() *apperr.Error {
	return apperr.New(http.StatusForbidden, apperr.CodeForbidden, "Notifications are not available for this account.")
}

// CheckRole refuse les rôles sans notifications.
func CheckRole(role string) error {
	if len(TypesFor(role)) == 0 {
		return errNotAllowed()
	}
	return nil
}
