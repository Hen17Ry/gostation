// Package pagination regroupe les règles communes des listes paginées par curseur
// (« ?limit=&cursor= » → « { items, nextCursor } ») : taille de page bornée et curseur opaque
// (date de tri + identifiant, en base64 URL).
package pagination

import (
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"gostation/backend/internal/apperr"
)

// Bornes de la taille de page.
const (
	DefaultLimit = 20
	MaxLimit     = 100
)

// Limit valide ?limit= (0 = valeur par défaut).
func Limit(limit int) (int, error) {
	switch {
	case limit == 0:
		return DefaultLimit, nil
	case limit < 1 || limit > MaxLimit:
		return 0, apperr.Validation(apperr.FieldError{Field: "limit", Code: "out_of_range", Message: fmt.Sprintf("must be between 1 and %d", MaxLimit)})
	}
	return limit, nil
}

// Encode construit un curseur (date de tri, identifiant de départage).
func Encode(t time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(t.UTC().Format(time.RFC3339Nano) + "|" + id))
}

// errInvalidCursor est rendu en 400 request.invalid_parameter.
func errInvalidCursor() error {
	return apperr.BadRequest(apperr.CodeInvalidParameter, "Invalid cursor.")
}

// Decode relit un curseur produit par Encode.
func Decode(c string) (time.Time, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, "", errInvalidCursor()
	}
	ts, id, ok := strings.Cut(string(raw), "|")
	if !ok || id == "" {
		return time.Time{}, "", errInvalidCursor()
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return time.Time{}, "", errInvalidCursor()
	}
	return t, id, nil
}
