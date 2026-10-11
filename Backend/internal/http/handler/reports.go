package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/notification"
	"gostation/backend/internal/report"
	"gostation/backend/internal/store/dbgen"
)

// Reports sert les signalements : création (comptes vérifiés), vue gérant, modération admin et
// alertes admin.
type Reports struct {
	rs  *respond.Responder
	svc *report.Service
}

// NewReports construit le handler.
func NewReports(rs *respond.Responder, svc *report.Service) *Reports {
	return &Reports{rs: rs, svc: svc}
}

func reportActor(r *http.Request) report.Actor {
	p := principal(r)
	return report.Actor{UserID: p.UserID, Role: p.Role}
}

type productRefDTO struct {
	ID    int16  `json:"id"`
	Label string `json:"label"`
}

func productRef(id *int16, label *string) *productRefDTO {
	if id == nil {
		return nil
	}
	return &productRefDTO{ID: *id, Label: deref(label)}
}

type stationRefDTO struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ── Création ────────────────────────────────────────────────────────────────

type reportRequest struct {
	Reason    string     `json:"reason"`
	ProductID *int16     `json:"productId"`
	Comment   *string    `json:"comment"`
	Position  *latLngDTO `json:"position"` // contrôle des 2 km, jamais stockée ni journalisée
}

type reportDTO struct {
	ID        string    `json:"id"`
	Reason    string    `json:"reason"`
	ProductID *int16    `json:"productId"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

// Create enregistre un signalement (POST /stations/{id}/reports).
func (h *Reports) Create(w http.ResponseWriter, r *http.Request) error {
	stationID, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var req reportRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	in := report.Input{Reason: req.Reason, ProductID: req.ProductID, Comment: req.Comment}
	if req.Position != nil {
		in.Position = &report.Position{Lat: req.Position.Lat, Lng: req.Position.Lng}
	}
	rep, err := h.svc.Create(r.Context(), principal(r).UserID, stationID, in)
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusCreated, reportDTO{
		ID: rep.ID.String(), Reason: rep.Reason, ProductID: rep.ProductID, Status: rep.Status, CreatedAt: rep.CreatedAt,
	})
	return nil
}

// ── Gérant ──────────────────────────────────────────────────────────────────

type reportFlagDTO struct {
	Reason     string         `json:"reason"`
	Product    *productRefDTO `json:"product"`
	Reporters  int            `json:"reporters"`
	Level      string         `json:"level"`
	FlaggedAt  time.Time      `json:"flaggedAt"`
	ExcludedAt *time.Time     `json:"excludedAt"`
}

type managerReportDTO struct {
	ID         string         `json:"id"`
	Reason     string         `json:"reason"`
	Product    *productRefDTO `json:"product"`
	Status     string         `json:"status"`
	CreatedAt  time.Time      `json:"createdAt"`
	ResolvedAt *time.Time     `json:"resolvedAt"`
}

type managerReportsResponse struct {
	Flags      []reportFlagDTO    `json:"flags"`
	Items      []managerReportDTO `json:"items"`
	NextCursor *string            `json:"nextCursor"`
}

// ManagerList renvoie les signalements de la station et leurs effets en cours, sans l'identité
// ni le commentaire des auteurs (GET /manager/reports?status=open|all&cursor&limit).
func (h *Reports) ManagerList(w http.ResponseWriter, r *http.Request) error {
	limit, err := queryLimit(r)
	if err != nil {
		return err
	}
	openOnly := true
	switch r.URL.Query().Get("status") {
	case "", "open":
	case "all":
		openOnly = false
	default:
		return apperr.BadRequest(apperr.CodeInvalidParameter, "status must be open or all.")
	}
	page, err := h.svc.ManagerReports(r.Context(), principal(r).UserID, openOnly, r.URL.Query().Get("cursor"), limit)
	if err != nil {
		return err
	}
	resp := managerReportsResponse{
		Flags: make([]reportFlagDTO, 0, len(page.Flags)), Items: make([]managerReportDTO, 0, len(page.Items)),
		NextCursor: cursorPtr(page.NextCursor),
	}
	for _, f := range page.Flags {
		level := notification.LevelFlagged
		if f.ExcludedAt != nil {
			level = notification.LevelExcluded
		}
		resp.Flags = append(resp.Flags, reportFlagDTO{
			Reason: f.Reason, Product: productRef(f.ProductID, f.ProductLabel), Reporters: f.Reporters,
			Level: level, FlaggedAt: f.FlaggedAt, ExcludedAt: f.ExcludedAt,
		})
	}
	for _, it := range page.Items {
		resp.Items = append(resp.Items, managerReportDTO{
			ID: it.ID.String(), Reason: it.Reason, Product: productRef(it.ProductID, it.ProductLabel),
			Status: it.Status, CreatedAt: it.CreatedAt, ResolvedAt: it.ResolvedAt,
		})
	}
	h.rs.JSON(w, r, http.StatusOK, resp)
	return nil
}

// ── Admin : signalements ────────────────────────────────────────────────────

type reporterDTO struct {
	ID              string `json:"id"`
	FirstName       string `json:"firstName"`
	LastName        string `json:"lastName"`
	Email           string `json:"email"`
	AbusiveReports  int32  `json:"abusiveReports"`
	ReportingBanned bool   `json:"reportingBanned"`
}

type adminReportDTO struct {
	ID             string         `json:"id"`
	Station        stationRefDTO  `json:"station"`
	Reason         string         `json:"reason"`
	Product        *productRefDTO `json:"product"`
	Comment        *string        `json:"comment"`
	Status         string         `json:"status"`
	Abusive        bool           `json:"abusive"`
	ResolutionNote *string        `json:"resolutionNote"`
	ResolvedAt     *time.Time     `json:"resolvedAt"`
	CreatedAt      time.Time      `json:"createdAt"`
	Reporter       *reporterDTO   `json:"reporter"`
}

func toAdminReport(r dbgen.ListReportsForAdminRow) adminReportDTO {
	d := adminReportDTO{
		ID: r.ID.String(), Station: stationRefDTO{ID: r.StationID.String(), Name: r.StationName},
		Reason: string(r.Reason), Product: productRef(r.ProductID, r.ProductLabel), Comment: r.Comment,
		Status: string(r.Status), Abusive: r.Abusive, ResolutionNote: r.ResolutionNote, ResolvedAt: r.ResolvedAt,
		CreatedAt: r.CreatedAt,
	}
	if r.ReporterID != nil {
		d.Reporter = &reporterDTO{
			ID: r.ReporterID.String(), FirstName: deref(r.ReporterFirstName), LastName: deref(r.ReporterLastName),
			Email: deref(r.ReporterEmail), AbusiveReports: r.ReporterAbusiveCount, ReportingBanned: r.ReporterBannedAt != nil,
		}
	}
	return d
}

type adminReportPage struct {
	Items      []adminReportDTO `json:"items"`
	NextCursor *string          `json:"nextCursor"`
}

// AdminList liste les signalements (GET /admin/reports?status&stationId&cursor&limit).
func (h *Reports) AdminList(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	limit, err := queryLimit(r)
	if err != nil {
		return err
	}
	f := report.AdminFilter{Status: q.Get("status"), Cursor: q.Get("cursor"), Limit: limit}
	if v := strings.TrimSpace(q.Get("stationId")); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			return apperr.BadRequest(apperr.CodeInvalidParameter, "stationId must be a UUID.")
		}
		f.StationID = &id
	}
	page, err := h.svc.AdminList(r.Context(), f)
	if err != nil {
		return err
	}
	resp := adminReportPage{Items: make([]adminReportDTO, 0, len(page.Items)), NextCursor: cursorPtr(page.NextCursor)}
	for _, it := range page.Items {
		resp.Items = append(resp.Items, toAdminReport(it))
	}
	h.rs.JSON(w, r, http.StatusOK, resp)
	return nil
}

type noteRequest struct {
	Note *string `json:"note"`
}

// Resolve marque un signalement comme traité (POST /admin/reports/{id}/resolve).
func (h *Reports) Resolve(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var req noteRequest
	if err := decodeJSON(r, &req, true); err != nil {
		return err
	}
	row, err := h.svc.Resolve(r.Context(), reportActor(r), id, req.Note)
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusOK, toAdminReport(row))
	return nil
}

type dismissRequest struct {
	Abusive bool    `json:"abusive"`
	Note    *string `json:"note"`
}

// Dismiss classe un signalement sans suite, éventuellement comme abusif
// (POST /admin/reports/{id}/dismiss).
func (h *Reports) Dismiss(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var req dismissRequest
	if err := decodeJSON(r, &req, true); err != nil {
		return err
	}
	row, err := h.svc.Dismiss(r.Context(), reportActor(r), id, req.Abusive, req.Note)
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusOK, toAdminReport(row))
	return nil
}

type banRequest struct {
	Reason *string `json:"reason"`
}

// Ban retire le droit de signaler (POST /admin/users/{id}/reporting-ban).
func (h *Reports) Ban(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var req banRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	if err := h.svc.Ban(r.Context(), reportActor(r), id, req.Reason); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// Unban rend le droit de signaler (DELETE /admin/users/{id}/reporting-ban).
func (h *Reports) Unban(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.Unban(r.Context(), reportActor(r), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ── Admin : alertes ─────────────────────────────────────────────────────────

type alertDTO struct {
	ID         string          `json:"id"`
	Kind       string          `json:"kind"`
	Station    stationRefDTO   `json:"station"`
	Reason     *string         `json:"reason"`
	Product    *productRefDTO  `json:"product"`
	Details    json.RawMessage `json:"details"`
	CreatedAt  time.Time       `json:"createdAt"`
	ResolvedAt *time.Time      `json:"resolvedAt"`
	ResolvedBy *string         `json:"resolvedBy"`
	Resolution *string         `json:"resolution"`
}

func toAlert(a report.Alert) alertDTO {
	d := alertDTO{
		ID: a.ID.String(), Kind: a.Kind, Station: stationRefDTO{ID: a.StationID.String(), Name: a.StationName},
		Reason: a.Reason, Product: productRef(a.ProductID, a.ProductLabel), Details: a.Details,
		CreatedAt: a.CreatedAt, ResolvedAt: a.ResolvedAt, Resolution: a.Resolution,
	}
	if a.ResolvedBy != nil {
		by := a.ResolvedBy.String()
		d.ResolvedBy = &by
	}
	return d
}

type alertPage struct {
	Items      []alertDTO `json:"items"`
	NextCursor *string    `json:"nextCursor"`
}

// Alerts liste les alertes admin (GET /admin/alerts?status=open|resolved|all&kind&cursor&limit).
func (h *Reports) Alerts(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	limit, err := queryLimit(r)
	if err != nil {
		return err
	}
	page, err := h.svc.Alerts(r.Context(), report.AlertFilter{Status: q.Get("status"), Kind: q.Get("kind"), Cursor: q.Get("cursor"), Limit: limit})
	if err != nil {
		return err
	}
	resp := alertPage{Items: make([]alertDTO, 0, len(page.Items)), NextCursor: cursorPtr(page.NextCursor)}
	for _, a := range page.Items {
		resp.Items = append(resp.Items, toAlert(a))
	}
	h.rs.JSON(w, r, http.StatusOK, resp)
	return nil
}

// ResolveAlert clôt une alerte (POST /admin/alerts/{id}/resolve).
func (h *Reports) ResolveAlert(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var req noteRequest
	if err := decodeJSON(r, &req, true); err != nil {
		return err
	}
	a, err := h.svc.ResolveAlert(r.Context(), reportActor(r), id, req.Note)
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusOK, toAlert(a))
	return nil
}
