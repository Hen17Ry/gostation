package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/privacy"
)

// Privacy sert les droits des personnes (étape 10A) : copie des données et demandes depuis l'app
// (/me/data-export, /me/data-requests), section « Demandes de données » de l'admin
// (/admin/data-requests).
type Privacy struct {
	rs  *respond.Responder
	svc *privacy.Service
}

// NewPrivacy construit le handler.
func NewPrivacy(rs *respond.Responder, svc *privacy.Service) *Privacy {
	return &Privacy{rs: rs, svc: svc}
}

// pathAndVersion lit l'identifiant de la route et la version attendue (If-Match).
func pathAndVersion(r *http.Request) (uuid.UUID, int32, error) {
	id, err := pathUUID(r, "id")
	if err != nil {
		return id, 0, err
	}
	v, err := expectedVersion(r)
	return id, v, err
}

func privacyActor(r *http.Request) privacy.Actor {
	p, _ := httpctx.PrincipalFrom(r.Context())
	return privacy.Actor{UserID: p.UserID, Role: p.Role}
}

// ── Copie des données ───────────────────────────────────────────────────────

type dataExportDTO struct {
	Status      string     `json:"status"` // none, pending, ready, failed, expired
	CreatedAt   *time.Time `json:"createdAt"`
	ExpiresAt   *time.Time `json:"expiresAt"`
	SizeBytes   *int64     `json:"sizeBytes"`
	DownloadURL *string    `json:"downloadUrl"`
}

func toDataExport(v privacy.ExportView) dataExportDTO {
	return dataExportDTO{Status: v.Status, CreatedAt: v.CreatedAt, ExpiresAt: v.ExpiresAt, SizeBytes: v.SizeBytes, DownloadURL: v.DownloadURL}
}

// RequestExport demande une copie des données (POST /me/data-export).
func (h *Privacy) RequestExport(w http.ResponseWriter, r *http.Request) error {
	v, err := h.svc.RequestExport(r.Context(), privacyActor(r))
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusAccepted, toDataExport(v))
	return nil
}

// ExportStatus renvoie la dernière copie et, si elle est prête, un lien signé (GET /me/data-export).
func (h *Privacy) ExportStatus(w http.ResponseWriter, r *http.Request) error {
	v, err := h.svc.ExportStatus(r.Context(), privacyActor(r))
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, toDataExport(v))
	return nil
}

// DownloadExport télécharge la copie (GET /me/data-export/{id}/download?expires&signature) : lien
// signé et session de la personne concernée.
func (h *Privacy) DownloadExport(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	q, err := strictQuery(r, "expires", "signature")
	if err != nil {
		return err
	}
	f, err := h.svc.DownloadExport(r.Context(), privacyActor(r), id, q.Get("expires"), q.Get("signature"))
	if err != nil {
		return err
	}
	hd := w.Header()
	hd.Set("Content-Type", f.ContentType)
	hd.Set("Content-Length", strconv.Itoa(len(f.Data)))
	hd.Set("Content-Disposition", `attachment; filename="`+f.Name+`"`)
	hd.Set("Cache-Control", "no-store")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(f.Data) //nolint:gosec // G705 : pièce jointe téléchargée (nosniff, CSP sandbox), jamais rendue
	return nil
}

// ── Demandes de la personne ─────────────────────────────────────────────────

type dataRequestDTO struct {
	ID          string     `json:"id"`
	Reference   string     `json:"reference"`
	Type        string     `json:"type"`
	Status      string     `json:"status"`
	Source      string     `json:"source"`
	CreatedAt   time.Time  `json:"createdAt"`
	DueAt       time.Time  `json:"dueAt"`
	CompletedAt *time.Time `json:"completedAt"`
	Response    *string    `json:"response"`
}

func toDataRequest(v privacy.Request) dataRequestDTO {
	return dataRequestDTO{
		ID: v.ID.String(), Reference: v.Reference, Type: v.Type, Status: v.Status, Source: v.Source,
		CreatedAt: v.CreatedAt, DueAt: v.DueAt, CompletedAt: v.CompletedAt, Response: v.Response,
	}
}

type createDataRequestRequest struct {
	Type    string `json:"type"`
	Details string `json:"details"`
}

// CreateRequest enregistre une demande d'exercice des droits (POST /me/data-requests).
func (h *Privacy) CreateRequest(w http.ResponseWriter, r *http.Request) error {
	var req createDataRequestRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	v, err := h.svc.CreateRequest(r.Context(), privacyActor(r), req.Type, req.Details)
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusCreated, toDataRequest(v))
	return nil
}

// MyRequests liste les demandes de la personne (GET /me/data-requests).
func (h *Privacy) MyRequests(w http.ResponseWriter, r *http.Request) error {
	list, err := h.svc.MyRequests(r.Context(), privacyActor(r))
	if err != nil {
		return err
	}
	out := struct {
		Items []dataRequestDTO `json:"items"`
	}{Items: make([]dataRequestDTO, 0, len(list))}
	for _, v := range list {
		out.Items = append(out.Items, toDataRequest(v))
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, out)
	return nil
}

// ── Admin : demandes de données ─────────────────────────────────────────────

type adminDataRequestUserDTO struct {
	ID        *string `json:"id,omitempty"`
	Email     *string `json:"email"`
	FirstName *string `json:"firstName,omitempty"`
	LastName  *string `json:"lastName,omitempty"`
	Role      *string `json:"role"`
	Deleted   *bool   `json:"deleted,omitempty"`
}

type adminDataRequestItemDTO struct {
	dataRequestDTO
	Verified bool                     `json:"verified"`
	Overdue  bool                     `json:"overdue"`
	DueSoon  bool                     `json:"dueSoon"`
	User     *adminDataRequestUserDTO `json:"user"`
}

type adminDataRequestActionsDTO struct {
	Verify        bool `json:"verify"`
	Export        bool `json:"export"`
	DeleteAccount bool `json:"deleteAccount"`
	Close         bool `json:"close"`
}

type adminDataRequestDTO struct {
	dataRequestDTO
	Version     int32                      `json:"version"`
	Details     *string                    `json:"details"`
	VerifiedAt  *time.Time                 `json:"verifiedAt"`
	UpdatedAt   time.Time                  `json:"updatedAt"`
	Overdue     bool                       `json:"overdue"`
	DueSoon     bool                       `json:"dueSoon"`
	HandledBy   *string                    `json:"handledBy"`
	CodePending bool                       `json:"codePending"`
	User        *adminDataRequestUserDTO   `json:"user"`
	Actions     adminDataRequestActionsDTO `json:"actions"`
}

func toAdminDataRequest(v privacy.AdminRequest) adminDataRequestDTO {
	d := adminDataRequestDTO{
		dataRequestDTO: toDataRequest(v.Request), Version: v.Version, Details: v.Details, VerifiedAt: v.VerifiedAt, UpdatedAt: v.UpdatedAt,
		Overdue: v.Overdue, DueSoon: v.DueSoon, HandledBy: v.HandledBy, CodePending: v.CodePending,
		Actions: adminDataRequestActionsDTO{Verify: v.CanVerify, Export: v.CanExport, DeleteAccount: v.CanDelete, Close: v.CanClose},
	}
	if u := v.User; u != nil {
		id := u.ID.String()
		d.User = &adminDataRequestUserDTO{ID: &id, Email: &u.Email, FirstName: &u.FirstName, LastName: &u.LastName, Role: &u.Role, Deleted: &u.Deleted}
	}
	return d
}

func (h *Privacy) writeAdmin(w http.ResponseWriter, r *http.Request, status int, v privacy.AdminRequest) {
	setETag(w, v.Version)
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, status, toAdminDataRequest(v))
}

// AdminList liste les demandes (GET /admin/data-requests?type&status&overdue&cursor&limit).
func (h *Privacy) AdminList(w http.ResponseWriter, r *http.Request) error {
	q, err := strictQuery(r, "type", "status", "overdue", "cursor", "limit")
	if err != nil {
		return err
	}
	limit, err := queryInt(q, "limit")
	if err != nil {
		return err
	}
	overdue, err := queryBool(q, "overdue")
	if err != nil {
		return err
	}
	page, err := h.svc.List(r.Context(), privacy.AdminFilter{
		Type: q.Get("type"), Status: q.Get("status"), Overdue: overdue != nil && *overdue, Cursor: q.Get("cursor"), Limit: limit,
	})
	if err != nil {
		return err
	}
	out := pageResponse[adminDataRequestItemDTO]{Items: make([]adminDataRequestItemDTO, 0, len(page.Items)), NextCursor: pageCursor(page.NextCursor)}
	for _, it := range page.Items {
		d := adminDataRequestItemDTO{
			dataRequestDTO: dataRequestDTO{
				ID: it.ID.String(), Reference: it.Reference, Type: it.Type, Status: it.Status, Source: it.Source,
				CreatedAt: it.CreatedAt, DueAt: it.DueAt, CompletedAt: it.CompletedAt,
			},
			Verified: it.Verified, Overdue: it.Overdue, DueSoon: it.DueSoon,
		}
		if it.UserEmail != nil {
			d.User = &adminDataRequestUserDTO{Email: it.UserEmail, Role: it.UserRole}
		}
		out.Items = append(out.Items, d)
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, out)
	return nil
}

// AdminGet renvoie une demande (GET /admin/data-requests/{id}), avec son ETag.
func (h *Privacy) AdminGet(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	v, err := h.svc.Get(r.Context(), id)
	if err != nil {
		return err
	}
	h.writeAdmin(w, r, http.StatusOK, v)
	return nil
}

type recordDataRequestRequest struct {
	Email   string `json:"email"`
	Type    string `json:"type"`
	Details string `json:"details"`
}

// AdminCreate enregistre une demande reçue par email et envoie le code de confirmation à l'adresse
// du compte (POST /admin/data-requests).
func (h *Privacy) AdminCreate(w http.ResponseWriter, r *http.Request) error {
	var req recordDataRequestRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	v, err := h.svc.RecordEmailRequest(r.Context(), privacyActor(r), req.Email, req.Type, req.Details)
	if err != nil {
		return err
	}
	w.Header().Set("Location", "/api/v1/admin/data-requests/"+v.ID.String())
	h.writeAdmin(w, r, http.StatusCreated, v)
	return nil
}

// AdminResendCode envoie un nouveau code de confirmation (POST /admin/data-requests/{id}/code).
func (h *Privacy) AdminResendCode(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	v, err := h.svc.ResendCode(r.Context(), privacyActor(r), id)
	if err != nil {
		return err
	}
	h.writeAdmin(w, r, http.StatusOK, v)
	return nil
}

type verifyDataRequestRequest struct {
	Code string `json:"code"`
}

// AdminVerify confirme l'identité avec le code (POST /admin/data-requests/{id}/verify, If-Match).
func (h *Privacy) AdminVerify(w http.ResponseWriter, r *http.Request) error {
	id, version, err := pathAndVersion(r)
	if err != nil {
		return err
	}
	var req verifyDataRequestRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	v, err := h.svc.Verify(r.Context(), privacyActor(r), id, version, req.Code)
	if err != nil {
		return err
	}
	h.writeAdmin(w, r, http.StatusOK, v)
	return nil
}

// AdminStart prend la demande en charge (POST /admin/data-requests/{id}/start, If-Match).
func (h *Privacy) AdminStart(w http.ResponseWriter, r *http.Request) error {
	id, version, err := pathAndVersion(r)
	if err != nil {
		return err
	}
	v, err := h.svc.Start(r.Context(), privacyActor(r), id, version)
	if err != nil {
		return err
	}
	h.writeAdmin(w, r, http.StatusOK, v)
	return nil
}

// AdminExport génère la copie des données de la personne, téléchargeable dans son app
// (POST /admin/data-requests/{id}/export, If-Match).
func (h *Privacy) AdminExport(w http.ResponseWriter, r *http.Request) error {
	id, version, err := pathAndVersion(r)
	if err != nil {
		return err
	}
	v, err := h.svc.GenerateExportFor(r.Context(), privacyActor(r), id, version)
	if err != nil {
		return err
	}
	h.writeAdmin(w, r, http.StatusAccepted, v)
	return nil
}

type deleteForRequestRequest struct {
	Response string `json:"response"`
}

// AdminDeleteAccount exécute une demande de suppression confirmée
// (POST /admin/data-requests/{id}/delete-account, If-Match).
func (h *Privacy) AdminDeleteAccount(w http.ResponseWriter, r *http.Request) error {
	id, version, err := pathAndVersion(r)
	if err != nil {
		return err
	}
	var req deleteForRequestRequest
	if err := decodeJSON(r, &req, true); err != nil {
		return err
	}
	v, err := h.svc.ExecuteDeletion(r.Context(), privacyActor(r), id, version, req.Response)
	if err != nil {
		return err
	}
	h.writeAdmin(w, r, http.StatusOK, v)
	return nil
}

type closeDataRequestRequest struct {
	Outcome  string `json:"outcome"`
	Response string `json:"response"`
}

// AdminClose clôt la demande avec une réponse ou un motif de refus
// (POST /admin/data-requests/{id}/close, If-Match).
func (h *Privacy) AdminClose(w http.ResponseWriter, r *http.Request) error {
	id, version, err := pathAndVersion(r)
	if err != nil {
		return err
	}
	var req closeDataRequestRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	v, err := h.svc.Close(r.Context(), privacyActor(r), id, version, req.Outcome, req.Response)
	if err != nil {
		return err
	}
	h.writeAdmin(w, r, http.StatusOK, v)
	return nil
}
