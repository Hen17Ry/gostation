// Package apperr définit les erreurs applicatives typées et leurs codes stables.
// Elles sont rendues en problem+json (RFC 9457) par internal/http/respond : seuls le statut,
// le code, le détail et les champs sont exposés au client ; la cause n'est que journalisée.
package apperr

import (
	"errors"
	"fmt"
	"maps"
	"net/http"
)

// Codes stables : les clients s'appuient dessus pour traduire les messages.
// On en ajoute, on ne les renomme jamais (liste : docs/ARCHITECTURE.md §5).
const (
	CodeInvalidJSON      = "request.invalid_json"
	CodeInvalidParameter = "request.invalid_parameter"
	CodeBodyTooLarge     = "request.body_too_large"
	CodeValidation       = "request.validation_failed"
	CodeTimeout          = "request.timeout"
	CodeUnauthorized     = "auth.unauthorized"
	CodeForbidden        = "auth.forbidden"
	CodeRouteNotFound    = "route.not_found"
	CodeMethodNotAllowed = "method.not_allowed"
	CodeNotFound         = "resource.not_found"
	CodeConflict         = "resource.conflict"
	CodeRateLimited      = "rate_limit.exceeded"
	CodeUnavailable      = "service.unavailable"
	CodeInternal         = "internal.error"
)

// FieldError décrit un champ invalide. Code est stable (required, out_of_range…),
// Message est une explication en anglais destinée aux développeurs.
type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Error est une erreur destinée au client.
type Error struct {
	Status int
	Code   string
	Detail string
	Fields []FieldError
	// Meta contient des membres d'extension du problem+json (ex. l'état des dépendances de /readyz).
	Meta  map[string]any
	cause error
}

func (e *Error) Error() string {
	if e.cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Detail, e.cause)
	}
	return e.Code + ": " + e.Detail
}

func (e *Error) Unwrap() error { return e.cause }

// Wrap renvoie une copie de l'erreur portant la cause (journalisée, jamais exposée).
func (e *Error) Wrap(cause error) *Error {
	c := *e
	c.cause = cause
	return &c
}

// WithMeta renvoie une copie de l'erreur avec un membre d'extension supplémentaire.
func (e *Error) WithMeta(key string, value any) *Error {
	c := *e
	c.Meta = maps.Clone(e.Meta)
	if c.Meta == nil {
		c.Meta = make(map[string]any, 1)
	}
	c.Meta[key] = value
	return &c
}

// New crée une erreur applicative.
func New(status int, code, detail string) *Error {
	return &Error{Status: status, Code: code, Detail: detail}
}

// BadRequest : requête mal formée (400).
func BadRequest(code, detail string) *Error { return New(http.StatusBadRequest, code, detail) }

// NotFound : ressource inexistante (404).
func NotFound(detail string) *Error { return New(http.StatusNotFound, CodeNotFound, detail) }

// Conflict : conflit avec l'état courant, par exemple une unicité (409).
func Conflict(detail string) *Error { return New(http.StatusConflict, CodeConflict, detail) }

// Validation : un ou plusieurs champs invalides (422).
func Validation(fields ...FieldError) *Error {
	e := New(http.StatusUnprocessableEntity, CodeValidation, "One or more fields are invalid.")
	e.Fields = fields
	return e
}

// TooManyRequests : quota dépassé (429).
func TooManyRequests(detail string) *Error {
	return New(http.StatusTooManyRequests, CodeRateLimited, detail)
}

// Unavailable : dépendance indisponible ou arrêt en cours (503).
func Unavailable(detail string) *Error {
	return New(http.StatusServiceUnavailable, CodeUnavailable, detail)
}

// Internal : erreur inattendue (500). Le détail exposé est générique, la cause est journalisée.
func Internal(cause error) *Error {
	return New(http.StatusInternalServerError, CodeInternal, "An unexpected error occurred.").Wrap(cause)
}

// As extrait la première *Error de la chaîne d'erreurs.
func As(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}

// HasCode indique si la chaîne d'erreurs contient une *Error portant ce code.
func HasCode(err error, code string) bool {
	e, ok := As(err)
	return ok && e.Code == code
}
