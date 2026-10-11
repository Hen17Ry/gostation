package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"gostation/backend/internal/audit"
)

// ── Journal d'audit ─────────────────────────────────────────────────────────

type auditActorDTO struct {
	ID        string  `json:"id"`
	Role      *string `json:"role"`
	FirstName *string `json:"firstName"`
	LastName  *string `json:"lastName"`
	Email     *string `json:"email"`
}

type auditEntryDTO struct {
	ID         string          `json:"id"`
	Actor      *auditActorDTO  `json:"actor"` // null : action système ou anonyme (login échoué…)
	Action     string          `json:"action"`
	EntityType string          `json:"entityType"`
	EntityID   *string         `json:"entityId"`
	Metadata   json.RawMessage `json:"metadata"`
	RequestID  *string         `json:"requestId"`
	CreatedAt  time.Time       `json:"createdAt"`
}

// Audit lit le journal d'audit, en lecture seule
// (GET /admin/audit?actorId&action&entityType&entityId&from&to&cursor&limit).
func (h *Admin) Audit(w http.ResponseWriter, r *http.Request) error {
	q, err := strictQuery(r, "actorId", "action", "entityType", "entityId", "from", "to", "cursor", "limit")
	if err != nil {
		return err
	}
	limit, err := queryInt(q, "limit")
	if err != nil {
		return err
	}
	actor, err := queryUUID(q, "actorId")
	if err != nil {
		return err
	}
	from, err := h.queryInstant(q, "from", false)
	if err != nil {
		return err
	}
	to, err := h.queryInstant(q, "to", true)
	if err != nil {
		return err
	}
	page, err := h.audit.List(r.Context(), audit.Filter{
		ActorID: actor, Action: q.Get("action"), EntityType: q.Get("entityType"), EntityID: q.Get("entityId"),
		From: from, To: to, Cursor: q.Get("cursor"), Limit: limit,
	})
	if err != nil {
		return err
	}
	out := pageResponse[auditEntryDTO]{Items: make([]auditEntryDTO, 0, len(page.Items)), NextCursor: pageCursor(page.NextCursor)}
	for _, e := range page.Items {
		d := auditEntryDTO{
			ID: strconv.FormatInt(e.ID, 10), Action: e.Action, EntityType: e.EntityType, EntityID: e.EntityID,
			Metadata: json.RawMessage(e.Metadata), RequestID: e.RequestID, CreatedAt: e.CreatedAt,
		}
		if e.ActorID != nil {
			d.Actor = &auditActorDTO{ID: e.ActorID.String(), FirstName: e.ActorFirstName, LastName: e.ActorLastName, Email: e.ActorEmail}
			if e.ActorRole != nil {
				role := string(*e.ActorRole)
				d.Actor.Role = &role
			}
		}
		out.Items = append(out.Items, d)
	}
	w.Header().Set("Cache-Control", "no-store")
	h.rs.JSON(w, r, http.StatusOK, out)
	return nil
}
