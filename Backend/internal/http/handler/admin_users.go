package handler

import (
	"net/http"
	"time"

	"gostation/backend/internal/auth"
	"gostation/backend/internal/store/dbgen"
)

// ── Comptes ─────────────────────────────────────────────────────────────────

type adminUserSummaryDTO struct {
	ID              string     `json:"id"`
	Role            string     `json:"role"`
	Status          string     `json:"status"`
	Email           string     `json:"email"`
	FirstName       string     `json:"firstName"`
	LastName        string     `json:"lastName"`
	EmailVerified   bool       `json:"emailVerified"`
	ReportingBanned bool       `json:"reportingBanned"`
	LastLoginAt     *time.Time `json:"lastLoginAt"`
	DisabledAt      *time.Time `json:"disabledAt"`
	CreatedAt       time.Time  `json:"createdAt"`
}

func toAdminUserSummary(u dbgen.ListUsersForAdminRow) adminUserSummaryDTO {
	return adminUserSummaryDTO{
		ID: u.ID.String(), Role: string(u.Role), Status: string(u.Status), Email: u.Email, FirstName: u.FirstName,
		LastName: u.LastName, EmailVerified: u.EmailVerifiedAt != nil, ReportingBanned: u.ReportingBannedAt != nil,
		LastLoginAt: u.LastLoginAt, DisabledAt: u.DisabledAt, CreatedAt: u.CreatedAt,
	}
}

// Users liste les comptes (GET /admin/users?q&role&status&emailVerified&cursor&limit).
func (h *Admin) Users(w http.ResponseWriter, r *http.Request) error {
	q, err := strictQuery(r, "q", "role", "status", "emailVerified", "cursor", "limit")
	if err != nil {
		return err
	}
	limit, err := queryInt(q, "limit")
	if err != nil {
		return err
	}
	verified, err := queryBool(q, "emailVerified")
	if err != nil {
		return err
	}
	page, err := h.users.ListUsers(r.Context(), auth.UserFilter{
		Query: q.Get("q"), Role: q.Get("role"), Status: q.Get("status"), EmailVerified: verified,
		Cursor: q.Get("cursor"), Limit: limit,
	})
	if err != nil {
		return err
	}
	out := pageResponse[adminUserSummaryDTO]{Items: make([]adminUserSummaryDTO, 0, len(page.Items)), NextCursor: pageCursor(page.NextCursor)}
	for _, u := range page.Items {
		out.Items = append(out.Items, toAdminUserSummary(u))
	}
	h.rs.JSON(w, r, http.StatusOK, out)
	return nil
}

type userStationDTO struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

type adminUserDTO struct {
	ID                   string     `json:"id"`
	Role                 string     `json:"role"`
	Status               string     `json:"status"`
	Email                string     `json:"email"`
	FirstName            string     `json:"firstName"`
	LastName             string     `json:"lastName"`
	EmailVerified        bool       `json:"emailVerified"`
	EmailVerifiedAt      *time.Time `json:"emailVerifiedAt"`
	PrivacyPolicyVersion string     `json:"privacyPolicyVersion"`
	PrivacyAcceptedAt    time.Time  `json:"privacyAcceptedAt"`
	TwoFactorEnabled     bool       `json:"twoFactorEnabled"`
	LastLoginAt          *time.Time `json:"lastLoginAt"`
	PasswordChangedAt    *time.Time `json:"passwordChangedAt"`
	DisabledAt           *time.Time `json:"disabledAt"`
	DisabledReason       *string    `json:"disabledReason"`
	ReportingBannedAt    *time.Time `json:"reportingBannedAt"`
	ReportingBanReason   *string    `json:"reportingBanReason"`
	DeletionRequestedAt  *time.Time `json:"deletionRequestedAt"`
	ActiveSessions       int        `json:"activeSessions"`
	Devices              int32      `json:"devices"`
	Reports              struct {
		Total   int32 `json:"total"`
		Abusive int32 `json:"abusive"`
	} `json:"reports"`
	Favorites int32           `json:"favorites"`
	Station   *userStationDTO `json:"station"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

func (h *Admin) writeUser(w http.ResponseWriter, r *http.Request, u auth.UserDetail) {
	d := adminUserDTO{
		ID: u.ID.String(), Role: string(u.Role), Status: string(u.Status), Email: u.Email, FirstName: u.FirstName,
		LastName: u.LastName, EmailVerified: u.EmailVerifiedAt != nil, EmailVerifiedAt: u.EmailVerifiedAt,
		PrivacyPolicyVersion: u.PrivacyPolicyVersion, PrivacyAcceptedAt: u.PrivacyAcceptedAt,
		TwoFactorEnabled: u.TotpEnabledAt != nil, LastLoginAt: u.LastLoginAt, PasswordChangedAt: u.PasswordChangedAt,
		DisabledAt: u.DisabledAt, DisabledReason: u.DisabledReason, ReportingBannedAt: u.ReportingBannedAt,
		ReportingBanReason: u.ReportingBanReason, DeletionRequestedAt: u.DeletionRequestedAt,
		ActiveSessions: u.ActiveSessions, Devices: u.Devices, Favorites: u.Favorites, CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt,
	}
	d.Reports.Total, d.Reports.Abusive = u.ReportsTotal, u.ReportsAbusive
	if u.StationID != nil && u.StationName != nil && u.StationStatus != nil {
		d.Station = &userStationDTO{ID: u.StationID.String(), Name: *u.StationName, Status: string(*u.StationStatus)}
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, d)
}

// User renvoie la fiche d'un compte (GET /admin/users/{id}).
func (h *Admin) User(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	u, err := h.users.UserDetail(r.Context(), id)
	if err != nil {
		return err
	}
	h.writeUser(w, r, u)
	return nil
}

type adminReasonRequest struct {
	Reason string `json:"reason"`
}

func (h *Admin) userAction(r *http.Request) (auth.Actor, adminReasonRequest, error) {
	var req adminReasonRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return auth.Actor{}, req, err
	}
	uid, role := adminActor(r)
	return auth.Actor{UserID: uid, Role: role}, req, nil
}

// DisableUser désactive un compte (POST /admin/users/{id}/disable).
func (h *Admin) DisableUser(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	a, req, err := h.userAction(r)
	if err != nil {
		return err
	}
	u, err := h.users.DisableUser(r.Context(), a, id, req.Reason)
	if err != nil {
		return err
	}
	h.writeUser(w, r, u)
	return nil
}

// ReactivateUser réactive un compte (POST /admin/users/{id}/reactivate).
func (h *Admin) ReactivateUser(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	a, req, err := h.userAction(r)
	if err != nil {
		return err
	}
	u, err := h.users.ReactivateUser(r.Context(), a, id, req.Reason)
	if err != nil {
		return err
	}
	h.writeUser(w, r, u)
	return nil
}

// ResendVerification renvoie le code de vérification (POST /admin/users/{id}/resend-verification).
func (h *Admin) ResendVerification(w http.ResponseWriter, r *http.Request) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	a, req, err := h.userAction(r)
	if err != nil {
		return err
	}
	if err := h.users.AdminResendVerification(r.Context(), a, id, req.Reason); err != nil {
		return err
	}
	w.WriteHeader(http.StatusAccepted)
	return nil
}
