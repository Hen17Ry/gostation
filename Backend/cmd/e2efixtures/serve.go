package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/station"
)

// serve lance le pilotage des parcours Maestro de l'app mobile : approuver, rejeter ou suspendre
// le dossier d'un gérant inscrit dans l'app, créer une station prête (approuvée, épinglée,
// horaires, produits, stocks), modifier ses stocks comme depuis un autre appareil (conflit 412).
// L'API n'a aucune route de test (D46) : ces actions passent par les services Go, sur la base E2E
// seulement (garde-fou de setup) et sur la boucle locale seulement (staging : la boucle locale du
// serveur, par un tunnel SSH). Les scripts Maestro (runScript, exécutés sur l'hôte) l'appellent en
// JSON.
func serve(ctx context.Context, getenv func(string) string, args []string) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	addr := fs.String("addr", "127.0.0.1:8097", "adresse d'écoute (boucle locale uniquement)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	host, _, err := net.SplitHostPort(*addr)
	if err != nil {
		return fmt.Errorf("addr: %w", err)
	}
	// Dans le conteneur du staging (E2E_STAGING=1), l'écoute est sur toutes les interfaces du
	// conteneur, dont le port n'est publié que sur la boucle locale du serveur
	// (deploy/staging.compose.yml).
	if ip := net.ParseIP(host); getenv("E2E_STAGING") != "1" && host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("refusing to listen on %s: loopback only", *addr)
	}
	f, done, err := setup(ctx, getenv)
	if err != nil {
		return err
	}
	defer done()

	c := &control{f: f}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	// Sonde du healthcheck Docker (healthprobe attend 200 sur /readyz).
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("POST /managers/approve", c.handle(c.approve))
	mux.HandleFunc("POST /managers/reject", c.handle(c.reject))
	mux.HandleFunc("POST /managers/suspend", c.handle(c.suspend))
	mux.HandleFunc("POST /managers/operational", c.handle(c.operational))
	mux.HandleFunc("POST /managers/bump-stocks", c.handle(c.bumpStocks))

	srv := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	slog.New(slog.NewTextHandler(os.Stderr, nil)).InfoContext(ctx, "e2efixtures: serving", slog.String("addr", *addr))
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

type control struct {
	mu sync.Mutex // une action à la fois (le fixer n'est pas fait pour la concurrence)
	f  *fixer
}

type request struct {
	Email  string  `json:"email"`
	Reason string  `json:"reason"`
	Name   string  `json:"name"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
}

func (c *control) handle(fn func(request) (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in request
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&in); err != nil {
			http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
			return
		}
		c.mu.Lock()
		out, err := fn(in)
		c.mu.Unlock()
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if out == nil {
			out = map[string]bool{"ok": true}
		}
		_ = json.NewEncoder(w).Encode(out)
	}
}

// stationOf retrouve la station d'un gérant par son email.
func (c *control) stationOf(email string) (uuid.UUID, error) {
	a, _, err := c.f.managerActor(strings.TrimSpace(email))
	if err != nil {
		return uuid.Nil, err
	}
	ms, err := c.f.svc.Station.ForManager(c.f.ctx, a.UserID)
	if err != nil {
		return uuid.Nil, err
	}
	return ms.ID, nil
}

func (c *control) approve(in request) (any, error) {
	id, err := c.stationOf(in.Email)
	if err != nil {
		return nil, err
	}
	return nil, c.f.approve(id.String())
}

func (c *control) reject(in request) (any, error) {
	return nil, c.decide(in, "reject", "Justificatif illisible : envoyez une photo nette de l'attestation IFU.")
}

func (c *control) suspend(in request) (any, error) {
	return nil, c.decide(in, "suspend", "Stocks déclarés sans rapport avec la réalité : contactez l'équipe.")
}

// decide applique une décision de l'admin (reject, suspend) avec un motif, celui donné sinon.
func (c *control) decide(in request, decision, fallback string) error {
	id, err := c.stationOf(in.Email)
	if err != nil {
		return err
	}
	st, err := c.f.svc.Station.AdminDetail(c.f.ctx, id)
	if err != nil {
		return err
	}
	reason := in.Reason
	if reason == "" {
		reason = fallback
	}
	if _, err := c.f.svc.Station.ChangeStatus(c.f.ctx, c.f.admin, id, st.Version, decision, reason); err != nil {
		return fmt.Errorf("%s: %w", decision, err)
	}
	return nil
}

// operational crée une station prête et renvoie les identifiants de son gérant.
func (c *control) operational(in request) (any, error) {
	name := in.Name
	if name == "" {
		name = "Station Zongo Marché"
	}
	lat, lng := in.Lat, in.Lng
	if lat == 0 && lng == 0 {
		lat, lng = 6.3654, 2.4183
	}
	st, err := c.f.operational(name, "Cotonou", lat, lng)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		"email":     st.ManagerEmail,
		"password":  c.f.account("", "", "").Password,
		"stationId": st.ID,
		"name":      st.Name,
		"ifu":       st.IFU,
	}, nil
}

// bumpStocks change un stock comme le ferait un autre appareil du gérant : la version de la
// station avance, la saisie en cours dans l'app recevra 412 à l'envoi.
func (c *control) bumpStocks(in request) (any, error) {
	a, v, err := c.f.managerActor(in.Email)
	if err != nil {
		return nil, err
	}
	view, err := c.f.svc.Station.Stocks(c.f.ctx, a.UserID)
	if err != nil {
		return nil, err
	}
	items := make([]station.StockInput, len(view.Items))
	for i, it := range view.Items {
		q := int(it.Quantity)
		if i == 0 {
			q += 5
		}
		items[i] = station.StockInput{ProductID: it.ProductID, Quantity: q}
	}
	if _, err := c.f.svc.Station.UpdateStocks(c.f.ctx, a, v, items); err != nil {
		return nil, fmt.Errorf("bump stocks: %w", err)
	}
	return nil, nil
}
