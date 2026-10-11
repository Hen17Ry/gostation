package audit

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/pagination"
	"gostation/backend/internal/store/dbgen"
)

// Lister est la requête sqlc de lecture du journal.
type Lister interface {
	ListAuditLogs(ctx context.Context, arg dbgen.ListAuditLogsParams) ([]dbgen.ListAuditLogsRow, error)
}

// Reader lit le journal d'audit pour l'admin (lecture seule).
type Reader struct {
	db Lister
}

// NewReader construit le lecteur.
func NewReader(db Lister) *Reader { return &Reader{db: db} }

// Filter filtre le journal : acteur, action (exacte, ou préfixe terminé par « * » : « admin.* »),
// cible (type et identifiant), période [From, To).
type Filter struct {
	ActorID    *uuid.UUID
	Action     string
	EntityType string
	EntityID   string
	From, To   *time.Time
	Cursor     string
	Limit      int
}

// Page est une page du journal.
type Page struct {
	Items      []dbgen.ListAuditLogsRow
	NextCursor string
}

var (
	actionPattern = regexp.MustCompile(`^[a-z0-9_.]{1,64}\*?$`)
	entityPattern = regexp.MustCompile(`^[a-z_]{1,32}$`)
)

func optional(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

// List renvoie une page du journal, les entrées les plus récentes d'abord.
func (r *Reader) List(ctx context.Context, f Filter) (Page, error) {
	limit, err := pagination.Limit(f.Limit)
	if err != nil {
		return Page{}, err
	}
	var fe []apperr.FieldError
	p := dbgen.ListAuditLogsParams{ActorID: f.ActorID, Since: f.From, Until: f.To, PageSize: int32(limit + 1)} //nolint:gosec // ≤ 101
	switch {
	case f.Action == "":
	case !actionPattern.MatchString(f.Action):
		fe = append(fe, apperr.FieldError{Field: "action", Code: "invalid", Message: "must be an action such as admin.station_approved, or a prefix such as admin.*"})
	case strings.HasSuffix(f.Action, "*"):
		p.ActionPrefix = optional(strings.ReplaceAll(strings.TrimSuffix(f.Action, "*"), "_", `\_`))
	default:
		p.Action = &f.Action
	}
	if f.EntityType != "" && !entityPattern.MatchString(f.EntityType) {
		fe = append(fe, apperr.FieldError{Field: "entityType", Code: "invalid", Message: "must be an entity type such as station, user or report"})
	}
	if len(f.EntityID) > 64 {
		fe = append(fe, apperr.FieldError{Field: "entityId", Code: "too_long", Message: "must be at most 64 characters"})
	}
	if f.From != nil && f.To != nil && !f.From.Before(*f.To) {
		fe = append(fe, apperr.FieldError{Field: "to", Code: "out_of_range", Message: "must be after from"})
	}
	if len(fe) > 0 {
		return Page{}, apperr.Validation(fe...)
	}
	p.EntityType, p.EntityID = optional(f.EntityType), optional(f.EntityID)
	if f.Cursor != "" {
		t, id, err := pagination.Decode(f.Cursor)
		if err != nil {
			return Page{}, err
		}
		n, err := strconv.ParseInt(id, 10, 64)
		if err != nil {
			return Page{}, apperr.BadRequest(apperr.CodeInvalidParameter, "Invalid cursor.")
		}
		p.CursorCreatedAt, p.CursorID = &t, &n
	}
	rows, err := r.db.ListAuditLogs(ctx, p)
	if err != nil {
		return Page{}, fmt.Errorf("audit: list: %w", err)
	}
	page := Page{Items: rows}
	if len(rows) > limit {
		page.Items = rows[:limit]
		last := page.Items[limit-1]
		page.NextCursor = pagination.Encode(last.CreatedAt, strconv.FormatInt(last.ID, 10))
	}
	return page, nil
}
