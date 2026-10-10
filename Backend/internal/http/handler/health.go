package handler

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/respond"
)

// Check vérifie une dépendance ; nil = disponible.
type Check func(ctx context.Context) error

// Statuts d'une dépendance dans la réponse de /readyz.
const (
	checkOK   = "ok"
	checkFail = "fail"
)

// Health sert /healthz (le processus répond) et /readyz (les dépendances répondent).
type Health struct {
	rs       *respond.Responder
	log      *slog.Logger
	checks   map[string]Check
	timeout  time.Duration
	draining atomic.Bool
}

// NewHealth construit les sondes. timeout borne chaque vérification de dépendance.
func NewHealth(rs *respond.Responder, log *slog.Logger, timeout time.Duration, checks map[string]Check) *Health {
	return &Health{rs: rs, log: log, checks: checks, timeout: timeout}
}

// SetDraining fait échouer /readyz pendant l'arrêt : le load balancer cesse d'envoyer du trafic
// pendant que les requêtes en cours se terminent.
func (h *Health) SetDraining() { h.draining.Store(true) }

// Live répond 200 tant que le processus sert des requêtes.
func (h *Health) Live(w http.ResponseWriter, r *http.Request) error {
	h.rs.JSON(w, r, http.StatusOK, map[string]string{"status": "ok"})
	return nil
}

type readyResponse struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks"`
}

// Ready vérifie toutes les dépendances en parallèle : 200 si toutes répondent, 503 sinon.
// Le détail des erreurs est journalisé, pas exposé.
func (h *Health) Ready(w http.ResponseWriter, r *http.Request) error {
	if h.draining.Load() {
		return apperr.Unavailable("Server is shutting down.")
	}
	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	var (
		mu      sync.Mutex
		wg      sync.WaitGroup
		results = make(map[string]string, len(h.checks))
		healthy = true
	)
	for name, check := range h.checks {
		wg.Go(func() {
			err := check(ctx)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				healthy = false
				results[name] = checkFail
				h.log.WarnContext(ctx, "readiness check failed", slog.String("check", name), slog.Any("err", err))
				return
			}
			results[name] = checkOK
		})
	}
	wg.Wait()

	if !healthy {
		return apperr.Unavailable("One or more dependencies are unavailable.").WithMeta("checks", results)
	}
	h.rs.JSON(w, r, http.StatusOK, readyResponse{Status: "ready", Checks: results})
	return nil
}
