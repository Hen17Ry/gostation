package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"gostation/backend/internal/apperr"
)

// decodeJSON lit un objet JSON strict : champs inconnus refusés, un seul objet, taille déjà
// bornée par le middleware MaxBodyBytes. allowEmpty accepte un corps vide (objet par défaut).
func decodeJSON(r *http.Request, dst any, allowEmpty bool) error {
	if ct := r.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(strings.ToLower(ct), "application/json") {
		return apperr.New(http.StatusUnsupportedMediaType, apperr.CodeInvalidJSON, "Content-Type must be application/json.")
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxBytes *http.MaxBytesError
		var syntax *json.SyntaxError
		var typeErr *json.UnmarshalTypeError
		switch {
		case errors.As(err, &maxBytes):
			return err // rendu en 413 par respond.Classify
		case errors.Is(err, io.EOF):
			if allowEmpty {
				return nil
			}
			return apperr.BadRequest(apperr.CodeInvalidJSON, "Request body must be a JSON object.")
		case errors.As(err, &syntax):
			return apperr.BadRequest(apperr.CodeInvalidJSON, fmt.Sprintf("Malformed JSON at offset %d.", syntax.Offset))
		case errors.As(err, &typeErr):
			return apperr.Validation(apperr.FieldError{
				Field: typeErr.Field, Code: "invalid_type",
				Message: "must be of type " + typeErr.Type.String(),
			})
		case strings.HasPrefix(err.Error(), "json: unknown field "):
			field := strings.Trim(strings.TrimPrefix(err.Error(), "json: unknown field "), `"`)
			return apperr.Validation(apperr.FieldError{Field: field, Code: "unknown_field", Message: "is not a known field"})
		default:
			return apperr.BadRequest(apperr.CodeInvalidJSON, "Malformed JSON.")
		}
	}
	if dec.More() {
		return apperr.BadRequest(apperr.CodeInvalidJSON, "Request body must contain a single JSON object.")
	}
	return nil
}
