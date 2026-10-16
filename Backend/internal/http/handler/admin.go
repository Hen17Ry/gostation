package handler

import (
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/analytics"
	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/auth"
	"gostation/backend/internal/catalog"
	"gostation/backend/internal/export"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/privacy"
)

// Admin sert le reste de l'API admin (étape 7) : tableau de bord, stats et pénuries, comptes,
// catalogue produits, journal d'audit et exports. Les routes sont montées dans le groupe admin
// (session web ouverte après 2FA, cookie + CSRF).
type Admin struct {
	rs        *respond.Responder
	analytics *analytics.Service
	users     *auth.Service
	catalog   *catalog.Service
	audit     *audit.Reader
	exports   *export.Service
	privacy   *privacy.Service
	loc       *time.Location
}

// AdminDeps regroupe les services utilisés.
type AdminDeps struct {
	Analytics *analytics.Service
	Users     *auth.Service
	Catalog   *catalog.Service
	Audit     *audit.Reader
	Exports   *export.Service
	Privacy   *privacy.Service
	Timezone  *time.Location
}

// NewAdmin construit le handler.
func NewAdmin(rs *respond.Responder, d AdminDeps) *Admin {
	return &Admin{
		rs: rs, analytics: d.Analytics, users: d.Users, catalog: d.Catalog,
		audit: d.Audit, exports: d.Exports, privacy: d.Privacy, loc: d.Timezone,
	}
}

// ── Paramètres de requête stricts ───────────────────────────────────────────

// strictQuery refuse les paramètres inconnus ou répétés (validation stricte des routes admin).
func strictQuery(r *http.Request, allowed ...string) (url.Values, error) {
	q := r.URL.Query()
	for k, v := range q {
		if !slices.Contains(allowed, k) {
			return nil, apperr.BadRequest(apperr.CodeInvalidParameter, "Unknown query parameter "+k+".")
		}
		if len(v) > 1 {
			return nil, apperr.BadRequest(apperr.CodeInvalidParameter, "Query parameter "+k+" must appear once.")
		}
	}
	return q, nil
}

func queryInt(q url.Values, name string) (int, error) {
	v := strings.TrimSpace(q.Get(name))
	if v == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, apperr.BadRequest(apperr.CodeInvalidParameter, name+" must be an integer.")
	}
	return n, nil
}

func queryBool(q url.Values, name string) (*bool, error) {
	v := strings.TrimSpace(q.Get(name))
	if v == "" {
		return nil, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return nil, apperr.BadRequest(apperr.CodeInvalidParameter, name+" must be true or false.")
	}
	return &b, nil
}

func queryProduct(q url.Values) (*int16, error) {
	v := strings.TrimSpace(q.Get("productId"))
	if v == "" {
		return nil, nil
	}
	n, err := strconv.ParseInt(v, 10, 16)
	if err != nil || n < 1 {
		return nil, apperr.BadRequest(apperr.CodeInvalidParameter, "productId must be a positive integer.")
	}
	id := int16(n)
	return &id, nil
}

func queryUUID(q url.Values, name string) (*uuid.UUID, error) {
	v := strings.TrimSpace(q.Get(name))
	if v == "" {
		return nil, nil
	}
	id, err := uuid.Parse(v)
	if err != nil {
		return nil, apperr.BadRequest(apperr.CodeInvalidParameter, name+" must be a UUID.")
	}
	return &id, nil
}

// queryInstant lit une borne de période : RFC 3339, ou date YYYY-MM-DD (minuit local ; pour une
// borne de fin, le lendemain à minuit, le jour est inclus).
func (h *Admin) queryInstant(q url.Values, name string, end bool) (*time.Time, error) {
	v := strings.TrimSpace(q.Get(name))
	if v == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return &t, nil
	}
	d, err := time.ParseInLocation(time.DateOnly, v, h.loc)
	if err != nil {
		return nil, apperr.BadRequest(apperr.CodeInvalidParameter, name+" must be a date (YYYY-MM-DD) or an RFC 3339 timestamp.")
	}
	if end {
		d = d.AddDate(0, 0, 1)
	}
	return &d, nil
}

func pageCursor(c string) *string {
	if c == "" {
		return nil
	}
	return &c
}

// adminActor renvoie l'admin de la requête.
func adminActor(r *http.Request) (uuid.UUID, string) {
	p := principal(r)
	return p.UserID, p.Role
}

type pageResponse[T any] struct {
	Items      []T     `json:"items"`
	NextCursor *string `json:"nextCursor"`
}
