// Package respond est le point unique de rendu des réponses : JSON pour les succès,
// problem+json (RFC 9457) pour les erreurs.
package respond

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/httpctx"
)

// Types de contenu des réponses.
const (
	ContentTypeJSON    = "application/json; charset=utf-8"
	ContentTypeProblem = "application/problem+json"
	ContentTypeGeoJSON = "application/geo+json" // cartes admin (RFC 7946)
)

// problemTypePrefix forme l'URI `type` du problem+json à partir du code stable.
const problemTypePrefix = "urn:gostation:problem:"

// Responder écrit les réponses et journalise les erreurs serveur.
type Responder struct {
	log *slog.Logger
}

// New construit un Responder.
func New(log *slog.Logger) *Responder {
	return &Responder{log: log}
}

// JSON écrit v en JSON avec le statut donné.
func (rs *Responder) JSON(w http.ResponseWriter, r *http.Request, status int, v any) {
	rs.JSONType(w, r, status, ContentTypeJSON, v)
}

// JSONType écrit v en JSON avec un type de contenu dérivé (ex. application/geo+json).
func (rs *Responder) JSONType(w http.ResponseWriter, r *http.Request, status int, contentType string, v any) {
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		rs.log.WarnContext(r.Context(), "write json response", slog.Any("err", err))
	}
}

// Error convertit err en problem+json, journalise les erreurs 5xx et écrit la réponse.
// Si le client a abandonné la requête, rien n'est écrit.
func (rs *Responder) Error(w http.ResponseWriter, r *http.Request, err error) {
	ctx := r.Context()
	if errors.Is(err, context.Canceled) && ctx.Err() != nil {
		rs.log.DebugContext(ctx, "request canceled by client", slog.String("path", r.URL.Path))
		return
	}
	appErr := Classify(err)
	if appErr.Status >= http.StatusInternalServerError {
		rs.log.ErrorContext(ctx, "request failed",
			slog.Int("status", appErr.Status),
			slog.String("code", appErr.Code),
			slog.String("path", r.URL.Path),
			slog.Any("err", err))
	}
	rs.WriteProblem(w, r, appErr)
}

// WriteProblem écrit l'erreur en problem+json, sans journaliser.
func (rs *Responder) WriteProblem(w http.ResponseWriter, r *http.Request, e *apperr.Error) {
	p := Problem{
		Type:       problemTypePrefix + e.Code,
		Title:      http.StatusText(e.Status),
		Status:     e.Status,
		Detail:     e.Detail,
		Instance:   r.URL.Path, // jamais la query string (elle peut contenir une position)
		Code:       e.Code,
		RequestID:  httpctx.RequestID(r.Context()),
		Errors:     e.Fields,
		Extensions: e.Meta,
	}
	h := w.Header()
	h.Set("Content-Type", ContentTypeProblem)
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(e.Status)
	if err := json.NewEncoder(w).Encode(p); err != nil {
		rs.log.WarnContext(r.Context(), "write problem response", slog.Any("err", err))
	}
}

// Classify associe une erreur quelconque à une erreur applicative :
// *apperr.Error telle quelle, corps trop gros → 413, délai dépassé → 504, le reste → 500.
func Classify(err error) *apperr.Error {
	if e, ok := apperr.As(err); ok {
		return e
	}
	var maxBytes *http.MaxBytesError
	switch {
	case errors.As(err, &maxBytes):
		return apperr.New(http.StatusRequestEntityTooLarge, apperr.CodeBodyTooLarge,
			fmt.Sprintf("Request body exceeds %d bytes.", maxBytes.Limit)).Wrap(err)
	case errors.Is(err, context.DeadlineExceeded):
		return apperr.New(http.StatusGatewayTimeout, apperr.CodeTimeout,
			"The request took too long to process.").Wrap(err)
	default:
		return apperr.Internal(err)
	}
}

// Problem est le corps d'une réponse d'erreur RFC 9457.
type Problem struct {
	Type       string
	Title      string
	Status     int
	Detail     string
	Instance   string
	Code       string
	RequestID  string
	Errors     []apperr.FieldError
	Extensions map[string]any
}

// MarshalJSON aplatit les membres d'extension au premier niveau, sans jamais écraser
// les membres standard.
func (p Problem) MarshalJSON() ([]byte, error) {
	m := make(map[string]any, 8+len(p.Extensions))
	for k, v := range p.Extensions {
		m[k] = v
	}
	m["type"] = p.Type
	m["title"] = p.Title
	m["status"] = p.Status
	m["code"] = p.Code
	if p.Detail != "" {
		m["detail"] = p.Detail
	}
	if p.Instance != "" {
		m["instance"] = p.Instance
	}
	if p.RequestID != "" {
		m["requestId"] = p.RequestID
	}
	if len(p.Errors) > 0 {
		m["errors"] = p.Errors
	}
	return json.Marshal(m)
}
