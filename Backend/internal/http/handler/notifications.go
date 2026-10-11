package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/notification"
	"gostation/backend/internal/reminder"
)

// Notifications sert les appareils push, la boîte de réception et les préférences
// (/me/devices, /me/notifications, /me/notification-settings).
type Notifications struct {
	rs  *respond.Responder
	svc *notification.Service
}

// NewNotifications construit le handler.
func NewNotifications(rs *respond.Responder, svc *notification.Service) *Notifications {
	return &Notifications{rs: rs, svc: svc}
}

func principal(r *http.Request) httpctx.Principal {
	p, _ := httpctx.PrincipalFrom(r.Context())
	return p
}

// queryLimit lit ?limit= (0 si absent : valeur par défaut du service).
func queryLimit(r *http.Request) (int, error) {
	v := strings.TrimSpace(r.URL.Query().Get("limit"))
	if v == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, apperr.BadRequest(apperr.CodeInvalidParameter, "limit must be an integer.")
	}
	return n, nil
}

func cursorPtr(c string) *string {
	if c == "" {
		return nil
	}
	return &c
}

// ── Appareils ───────────────────────────────────────────────────────────────

type deviceRequest struct {
	Token      string  `json:"token"`
	Platform   string  `json:"platform"`
	InstallID  string  `json:"installId"`
	Language   string  `json:"language"`
	AppVersion *string `json:"appVersion"`
}

type deviceDTO struct {
	ID         string    `json:"id"`
	Platform   string    `json:"platform"`
	Language   string    `json:"language"`
	AppVersion *string   `json:"appVersion"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

// RegisterDevice enregistre le token push de l'installation, lié à la session courante
// (POST /me/devices). À rappeler à chaque lancement de l'app : last_seen_at est repoussé.
func (h *Notifications) RegisterDevice(w http.ResponseWriter, r *http.Request) error {
	p := principal(r)
	if err := notification.CheckRole(p.Role); err != nil {
		return err
	}
	var req deviceRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	installID, err := uuid.Parse(strings.TrimSpace(req.InstallID))
	if err != nil {
		return apperr.Validation(apperr.FieldError{Field: "installId", Code: "invalid", Message: "must be a UUID"})
	}
	d, err := h.svc.RegisterDevice(r.Context(), p.UserID, p.SessionID, notification.DeviceInput{
		Token: req.Token, Platform: req.Platform, InstallID: installID, Language: req.Language, AppVersion: req.AppVersion,
	})
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusOK, deviceDTO{
		ID: d.ID.String(), Platform: d.Platform, Language: d.Language, AppVersion: d.AppVersion,
		CreatedAt: d.CreatedAt, LastSeenAt: d.LastSeenAt,
	})
	return nil
}

// UnregisterDevice supprime un appareil du compte (DELETE /me/devices/{id}).
func (h *Notifications) UnregisterDevice(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.UnregisterDevice(r.Context(), principal(r).UserID, id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ── Boîte de réception ──────────────────────────────────────────────────────

type notificationDTO struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
	CreatedAt time.Time       `json:"createdAt"`
	ReadAt    *time.Time      `json:"readAt"`
}

type inboxResponse struct {
	Items       []notificationDTO `json:"items"`
	NextCursor  *string           `json:"nextCursor"`
	UnreadCount int64             `json:"unreadCount"`
}

// Inbox renvoie la boîte de réception, la plus récente d'abord (GET /me/notifications).
func (h *Notifications) Inbox(w http.ResponseWriter, r *http.Request) error {
	limit, err := queryLimit(r)
	if err != nil {
		return err
	}
	page, err := h.svc.Inbox(r.Context(), principal(r).UserID, r.URL.Query().Get("cursor"), limit)
	if err != nil {
		return err
	}
	resp := inboxResponse{Items: make([]notificationDTO, 0, len(page.Items)), NextCursor: cursorPtr(page.NextCursor), UnreadCount: page.Unread}
	for _, it := range page.Items {
		resp.Items = append(resp.Items, notificationDTO{ID: it.ID.String(), Type: it.Type, Data: it.Data, CreatedAt: it.CreatedAt, ReadAt: it.ReadAt})
	}
	h.rs.JSON(w, r, http.StatusOK, resp)
	return nil
}

type markReadRequest struct {
	IDs []string `json:"ids"`
	All bool     `json:"all"`
}

type unreadResponse struct {
	UnreadCount int64 `json:"unreadCount"`
}

// MarkRead marque des notifications comme lues (POST /me/notifications/read).
func (h *Notifications) MarkRead(w http.ResponseWriter, r *http.Request) error {
	var req markReadRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	ids := make([]uuid.UUID, 0, len(req.IDs))
	for i, raw := range req.IDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			return apperr.Validation(apperr.FieldError{Field: "ids[" + strconv.Itoa(i) + "]", Code: "invalid", Message: "must be a UUID"})
		}
		ids = append(ids, id)
	}
	unread, err := h.svc.MarkRead(r.Context(), principal(r).UserID, ids, req.All)
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusOK, unreadResponse{UnreadCount: unread})
	return nil
}

// ── Préférences ─────────────────────────────────────────────────────────────

type settingDTO struct {
	Type    string `json:"type"`
	Enabled bool   `json:"enabled"`
}

type settingsRequest struct {
	Settings []settingDTO `json:"settings"`
}

func (h *Notifications) writeSettings(w http.ResponseWriter, r *http.Request, settings []notification.Setting) {
	items := make([]settingDTO, 0, len(settings))
	for _, s := range settings {
		items = append(items, settingDTO{Type: string(s.Type), Enabled: s.Enabled})
	}
	h.rs.JSON(w, r, http.StatusOK, listResponse[settingDTO]{Items: items})
}

// Settings renvoie les préférences par type (GET /me/notification-settings).
func (h *Notifications) Settings(w http.ResponseWriter, r *http.Request) error {
	p := principal(r)
	if err := notification.CheckRole(p.Role); err != nil {
		return err
	}
	settings, err := h.svc.Settings(r.Context(), p.UserID, p.Role)
	if err != nil {
		return err
	}
	h.writeSettings(w, r, settings)
	return nil
}

// UpdateSettings active ou désactive des types (PUT /me/notification-settings).
func (h *Notifications) UpdateSettings(w http.ResponseWriter, r *http.Request) error {
	p := principal(r)
	if err := notification.CheckRole(p.Role); err != nil {
		return err
	}
	var req settingsRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	changes := make([]notification.Setting, 0, len(req.Settings))
	for _, s := range req.Settings {
		changes = append(changes, notification.Setting{Type: notification.Type(s.Type), Enabled: s.Enabled})
	}
	settings, err := h.svc.UpdateSettings(r.Context(), p.UserID, p.Role, changes)
	if err != nil {
		return err
	}
	h.writeSettings(w, r, settings)
	return nil
}

// ── Rappels (gérant) ────────────────────────────────────────────────────────

// Reminders sert la sourdine des rappels de stock (POST /manager/reminders/mute).
type Reminders struct {
	rs  *respond.Responder
	svc *reminder.Service
}

// NewReminders construit le handler.
func NewReminders(rs *respond.Responder, svc *reminder.Service) *Reminders {
	return &Reminders{rs: rs, svc: svc}
}

type muteResponse struct {
	MutedUntil time.Time `json:"mutedUntil"`
}

// Mute met les rappels en sourdine jusqu'à la fermeture du jour.
func (h *Reminders) Mute(w http.ResponseWriter, r *http.Request) error {
	until, err := h.svc.Mute(r.Context(), principal(r).UserID)
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusOK, muteResponse{MutedUntil: until})
	return nil
}
