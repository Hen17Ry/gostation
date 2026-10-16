package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/auth"
	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/privacy"
)

// Me sert les routes /api/v1/me (compte de l'utilisateur authentifié).
type Me struct {
	rs      *respond.Responder
	svc     *auth.Service
	auth    *Auth // pour effacer les cookies de session à la suppression du compte
	privacy *privacy.Service
}

// NewMe construit le handler.
func NewMe(rs *respond.Responder, svc *auth.Service, a *Auth, p *privacy.Service) *Me {
	return &Me{rs: rs, svc: svc, auth: a, privacy: p}
}

func actor(r *http.Request) auth.Actor {
	p, _ := httpctx.PrincipalFrom(r.Context())
	return auth.Actor{UserID: p.UserID, Role: p.Role, SessionID: p.SessionID}
}

// Get renvoie le profil (GET /me), avec la station d'un gérant et le flag de réacceptation.
func (h *Me) Get(w http.ResponseWriter, r *http.Request) error {
	p, err := h.svc.Profile(r.Context(), actor(r).UserID)
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusOK, toProfileDTO(p))
	return nil
}

type updateProfileRequest struct {
	FirstName *string `json:"firstName"`
	LastName  *string `json:"lastName"`
}

// Update modifie prénom et/ou nom (PATCH /me).
func (h *Me) Update(w http.ResponseWriter, r *http.Request) error {
	var req updateProfileRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	p, err := h.svc.UpdateProfile(r.Context(), actor(r).UserID, req.FirstName, req.LastName)
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusOK, toProfileDTO(p))
	return nil
}

type acceptPrivacyRequest struct {
	Version string `json:"version"`
}

// AcceptPrivacyPolicy accepte la version courante de la politique (POST /me/accept-privacy-policy).
func (h *Me) AcceptPrivacyPolicy(w http.ResponseWriter, r *http.Request) error {
	var req acceptPrivacyRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	p, err := h.svc.AcceptPrivacyPolicy(r.Context(), actor(r).UserID, req.Version)
	if err != nil {
		return err
	}
	h.rs.JSON(w, r, http.StatusOK, toProfileDTO(p))
	return nil
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

// ChangePassword change le mot de passe et révoque les autres sessions (POST /me/change-password).
func (h *Me) ChangePassword(w http.ResponseWriter, r *http.Request) error {
	var req changePasswordRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	if err := h.svc.ChangePassword(r.Context(), actor(r), req.CurrentPassword, req.NewPassword); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type sessionDTO struct {
	ID         string    `json:"id"`
	Client     string    `json:"client"`
	UserAgent  string    `json:"userAgent"`
	CreatedAt  time.Time `json:"createdAt"`
	LastUsedAt time.Time `json:"lastUsedAt"`
	Current    bool      `json:"current"`
}

// Sessions liste les sessions actives (GET /me/sessions).
func (h *Me) Sessions(w http.ResponseWriter, r *http.Request) error {
	a := actor(r)
	list, err := h.svc.ListSessions(r.Context(), a.UserID)
	if err != nil {
		return err
	}
	items := make([]sessionDTO, 0, len(list))
	for _, s := range list {
		items = append(items, sessionDTO{
			ID: s.ID, Client: s.Client, UserAgent: s.UserAgent,
			CreatedAt: s.CreatedAt.UTC(), LastUsedAt: s.LastUsedAt.UTC(), Current: s.ID == a.SessionID,
		})
	}
	h.rs.JSON(w, r, http.StatusOK, listResponse[sessionDTO]{Items: items})
	return nil
}

// RevokeSession révoque une session de l'utilisateur (DELETE /me/sessions/{id}).
func (h *Me) RevokeSession(w http.ResponseWriter, r *http.Request) error {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		return apperr.BadRequest(apperr.CodeInvalidParameter, "Session id must be a UUID.")
	}
	a := actor(r)
	if err := h.svc.RevokeSession(r.Context(), a, id); err != nil {
		return err
	}
	if id == a.SessionID {
		h.auth.clearSessionCookies(w)
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type deleteAccountRequest struct {
	Password string `json:"password"`
}

// Delete supprime le compte (anonymisation immédiate, sessions et appareils révoqués ; station d'un
// gérant retirée de la recherche), après confirmation par le mot de passe (DELETE /me).
func (h *Me) Delete(w http.ResponseWriter, r *http.Request) error {
	var req deleteAccountRequest
	if err := decodeJSON(r, &req, false); err != nil {
		return err
	}
	if err := h.privacy.DeleteMyAccount(r.Context(), privacyActor(r), req.Password); err != nil {
		return err
	}
	h.auth.clearSessionCookies(w)
	w.WriteHeader(http.StatusNoContent)
	return nil
}
