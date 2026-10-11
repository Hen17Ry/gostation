package station

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// AdminFilter filtre la liste admin des stations.
type AdminFilter struct {
	Status      string
	Query       string
	NeedsReview bool // épingle signalée ou demande de déplacement en attente
	Cursor      string
	Limit       int
}

// AdminPage est une page de la liste admin.
type AdminPage struct {
	Items      []dbgen.ListStationsForAdminRow
	NextCursor string
}

func encodeCursor(t time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(t.UTC().Format(time.RFC3339Nano) + "|" + id.String()))
}

func decodeCursor(c string) (time.Time, uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	ts, id, ok := strings.Cut(string(raw), "|")
	if !ok {
		return time.Time{}, uuid.Nil, fmt.Errorf("malformed cursor")
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	u, err := uuid.Parse(id)
	return t, u, err
}

// likeEscaper protège les jokers de LIKE dans la recherche par nom ou IFU.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// AdminList liste les stations d'un statut, les plus récentes d'abord. Un dossier pending n'y
// figure qu'une fois l'email du gérant vérifié (D5).
func (s *Service) AdminList(ctx context.Context, f AdminFilter) (AdminPage, error) {
	switch f.Status {
	case StatusPending, StatusApproved, StatusRejected, StatusSuspended:
	default:
		return AdminPage{}, apperr.Validation(apperr.FieldError{Field: "status", Code: "invalid", Message: "must be pending, approved, rejected or suspended"})
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		return AdminPage{}, apperr.Validation(apperr.FieldError{Field: "limit", Code: "out_of_range", Message: "must be between 1 and 100"})
	}
	p := dbgen.ListStationsForAdminParams{Status: dbgen.StationStatus(f.Status), NeedsReview: f.NeedsReview, PageSize: int32(limit + 1)} //nolint:gosec // ≤ 101
	if q := strings.TrimSpace(f.Query); q != "" {
		if len([]rune(q)) > 100 {
			return AdminPage{}, apperr.Validation(apperr.FieldError{Field: "q", Code: "too_long", Message: "must be at most 100 characters"})
		}
		escaped := likeEscaper.Replace(q)
		p.Query = &escaped
	}
	if f.Cursor != "" {
		t, id, err := decodeCursor(f.Cursor)
		if err != nil {
			return AdminPage{}, apperr.BadRequest(apperr.CodeInvalidParameter, "Invalid cursor.")
		}
		p.CursorCreatedAt, p.CursorID = &t, &id
	}
	rows, err := s.Store.ListStationsForAdmin(ctx, p)
	if err != nil {
		return AdminPage{}, fmt.Errorf("station: admin list: %w", err)
	}
	page := AdminPage{Items: rows}
	if len(rows) > limit {
		page.Items = rows[:limit]
		last := page.Items[limit-1]
		page.NextCursor = encodeCursor(last.CreatedAt, last.ID)
	}
	return page, nil
}

// ensureStation renvoie 404 si la station n'existe pas (avant le contrôle de version, qui
// répondrait sinon 412).
func ensureStation(ctx context.Context, q *dbgen.Queries, id uuid.UUID) error {
	if _, err := q.GetStationDocument(ctx, id); err != nil {
		return fmt.Errorf("station: load station: %w", store.Translate(err))
	}
	return nil
}

// AdminStation est la vue admin détaillée d'une station.
type AdminStation struct {
	dbgen.GetStationForAdminRow
	PendingMove *LocationRequest
}

// AdminDetail renvoie le détail d'une station.
func (s *Service) AdminDetail(ctx context.Context, stationID uuid.UUID) (AdminStation, error) {
	row, err := s.Store.GetStationForAdmin(ctx, stationID)
	if err != nil {
		return AdminStation{}, fmt.Errorf("station: admin detail: %w", store.Translate(err))
	}
	move, err := s.pendingMove(ctx, s.Store.Queries, stationID)
	if err != nil {
		return AdminStation{}, err
	}
	return AdminStation{GetStationForAdminRow: row, PendingMove: move}, nil
}

// transition décrit une décision admin sur le statut.
type transition struct {
	action   string // verbe des messages d'erreur
	from     string
	to       dbgen.StationStatus
	email    mail.StationStatusChange
	audit    string
	reasonOK bool // motif obligatoire
}

var transitions = map[string]transition{
	"approve":   {"approve", StatusPending, dbgen.StationStatusApproved, mail.StationApproved, audit.ActionStationApproved, false},
	"reject":    {"reject", StatusPending, dbgen.StationStatusRejected, mail.StationRejected, audit.ActionStationRejected, true},
	"suspend":   {"suspend", StatusApproved, dbgen.StationStatusSuspended, mail.StationSuspended, audit.ActionStationSuspended, true},
	"unsuspend": {"unsuspend", StatusSuspended, dbgen.StationStatusApproved, mail.StationReinstated, audit.ActionStationUnsuspended, true},
}

// ChangeStatus applique une décision admin (approve, reject, suspend, unsuspend) : transition
// autorisée, motif obligatoire sauf pour approve, email au gérant, audit, invalidation du cache.
func (s *Service) ChangeStatus(ctx context.Context, admin Actor, stationID uuid.UUID, expected int32, decision, reason string) (AdminStation, error) {
	tr, ok := transitions[decision]
	if !ok {
		return AdminStation{}, fmt.Errorf("station: unknown decision %q", decision)
	}
	var reasonPtr *string
	if tr.reasonOK {
		r, err := requireReason(reason)
		if err != nil {
			return AdminStation{}, err
		}
		reasonPtr = &r
	}
	var contact dbgen.GetStationContactRow
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		var err error
		contact, err = q.GetStationContact(ctx, stationID)
		if err != nil {
			return fmt.Errorf("station: load station: %w", store.Translate(err))
		}
		if _, err := bump(ctx, q, stationID, expected); err != nil {
			return err
		}
		if string(contact.Status) != tr.from {
			return errTransition(string(contact.Status), tr.action)
		}
		if decision == "approve" && contact.EmailVerifiedAt == nil {
			return apperr.New(http.StatusConflict, CodeManagerEmailUnverified, "The manager has not verified their email address yet.")
		}
		return q.SetStationStatus(ctx, dbgen.SetStationStatusParams{ID: stationID, Status: tr.to, Reason: reasonPtr, ReviewedBy: &admin.UserID})
	})
	if err != nil {
		return AdminStation{}, err
	}
	meta := map[string]any{"from": tr.from, "to": string(tr.to)}
	if reasonPtr != nil {
		meta["reason"] = *reasonPtr
	}
	s.audit(ctx, admin, tr.audit, stationID, meta)
	s.invalidate(ctx, true)
	s.notify(ctx, stationID, tr.email, reason)
	return s.AdminDetail(ctx, stationID)
}

// ResolveMove valide ou refuse la demande de déplacement en attente (motif obligatoire pour un
// refus). Validée, la nouvelle position et sa cellule H3 remplacent l'ancienne.
func (s *Service) ResolveMove(ctx context.Context, admin Actor, stationID, requestID uuid.UUID, expected int32, approve bool, reason string) (AdminStation, error) {
	var reasonPtr *string
	if !approve {
		r, err := requireReason(reason)
		if err != nil {
			return AdminStation{}, err
		}
		reasonPtr = &r
	}
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := ensureStation(ctx, q, stationID); err != nil {
			return err
		}
		if _, err := bump(ctx, q, stationID, expected); err != nil {
			return err
		}
		if approve {
			if n, err := q.ApplyLocationRequest(ctx, requestID); err != nil {
				return fmt.Errorf("station: apply move: %w", err)
			} else if n == 0 {
				return apperr.NotFound("No pending location request with this id.")
			}
		}
		status := dbgen.LocationRequestStatusRejected
		if approve {
			status = dbgen.LocationRequestStatusApproved
		}
		n, err := q.ResolveLocationRequest(ctx, dbgen.ResolveLocationRequestParams{
			ID: requestID, StationID: stationID, Status: status, Reason: reasonPtr, ReviewedBy: &admin.UserID,
		})
		if err != nil {
			return fmt.Errorf("station: resolve move: %w", err)
		}
		if n == 0 {
			return apperr.NotFound("No pending location request with this id.")
		}
		return nil
	})
	if err != nil {
		return AdminStation{}, err
	}
	action, meta := audit.ActionLocationRequestRejected, map[string]any{"requestId": requestID.String()}
	change := mail.StationMoveRejected
	if approve {
		action, change = audit.ActionLocationRequestApproved, mail.StationMoveApproved
		s.invalidate(ctx, true)
		reason = ""
	} else {
		meta["reason"] = *reasonPtr
		reason = *reasonPtr
	}
	s.audit(ctx, admin, action, stationID, meta)
	s.notify(ctx, stationID, change, reason)
	return s.AdminDetail(ctx, stationID)
}

// DismissLocationFlag lève le signalement d'une épingle éloignée de l'appareil du gérant.
func (s *Service) DismissLocationFlag(ctx context.Context, admin Actor, stationID uuid.UUID, expected int32) (AdminStation, error) {
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := ensureStation(ctx, q, stationID); err != nil {
			return err
		}
		if _, err := bump(ctx, q, stationID, expected); err != nil {
			return err
		}
		return q.ClearStationLocationFlag(ctx, stationID)
	})
	if err != nil {
		return AdminStation{}, err
	}
	s.audit(ctx, admin, audit.ActionLocationFlagDismissed, stationID, nil)
	return s.AdminDetail(ctx, stationID)
}
