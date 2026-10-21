package respond

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// routePattern renvoie le modèle de la route chi (« /api/v1/stations/{id} »), jamais le chemin réel.
func routePattern(r *http.Request) string {
	if rc := chi.RouteContext(r.Context()); rc != nil {
		if p := rc.RoutePattern(); p != "" {
			return p
		}
	}
	return "unmatched"
}
