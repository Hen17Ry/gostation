// Package handler contient les handlers HTTP. Ils renvoient une error, rendue par un point
// unique (respond.Responder.Error) : aucun handler n'écrit lui-même de réponse d'erreur.
package handler

import (
	"net/http"

	"gostation/backend/internal/http/respond"
)

// Func est la signature des handlers de l'API.
type Func func(w http.ResponseWriter, r *http.Request) error

// Handle adapte un Func en http.HandlerFunc.
func Handle(rs *respond.Responder, fn Func) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			rs.Error(w, r, err)
		}
	}
}

// listResponse est l'enveloppe des listes : { "items": [...] } (puis nextCursor pour les listes paginées).
type listResponse[T any] struct {
	Items []T `json:"items"`
}
