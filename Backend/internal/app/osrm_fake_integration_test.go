//go:build integration

package app_test

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"gostation/backend/internal/platform/h3"
)

// Modes du faux OSRM.
const (
	osrmOK      int32 = iota
	osrmError         // HTTP 500 {"code":"InternalError"}
	osrmTimeout       // répond après le délai du client
	osrmHangUp        // ferme la connexion sans réponse
)

// fakeOSRM imite /nearest, /table et /route : distance routière = vol d'oiseau × 1,25,
// vitesse 11 m/s (≈ 40 km/h).
type fakeOSRM struct {
	mode       atomic.Int32
	tableCalls atomic.Int32
	maxDests   atomic.Int32
	delay      time.Duration
}

func parseCoords(path, prefix string) [][2]float64 {
	raw := strings.TrimPrefix(path, prefix)
	var out [][2]float64
	for _, p := range strings.Split(raw, ";") {
		lng, lat, _ := strings.Cut(p, ",")
		x, _ := strconv.ParseFloat(lng, 64)
		y, _ := strconv.ParseFloat(lat, 64)
		out = append(out, [2]float64{y, x})
	}
	return out
}

func roadLeg(a, b [2]float64) (dist, dur float64) {
	dist = h3.Haversine(a[0], a[1], b[0], b[1]) * 1.25
	return math.Round(dist*10) / 10, math.Round(dist/11*10) / 10
}

func (f *fakeOSRM) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch f.mode.Load() {
	case osrmError:
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"code":"InternalError","message":"boom"}`))
		return
	case osrmTimeout:
		select {
		case <-time.After(f.delay):
		case <-r.Context().Done():
		}
		return
	case osrmHangUp:
		if hj, ok := w.(http.Hijacker); ok {
			conn, _, _ := hj.Hijack()
			_ = conn.Close()
		}
		return
	}
	var body any
	switch {
	case strings.HasPrefix(r.URL.Path, "/nearest/"):
		body = map[string]any{"code": "Ok", "waypoints": []any{}}
	case strings.HasPrefix(r.URL.Path, "/table/v1/driving/"):
		f.tableCalls.Add(1)
		pts := parseCoords(r.URL.Path, "/table/v1/driving/")
		if n := int32(len(pts) - 1); n > f.maxDests.Load() {
			f.maxDests.Store(n)
		}
		durs, dists := make([]float64, len(pts)), make([]float64, len(pts))
		for i, p := range pts {
			dists[i], durs[i] = roadLeg(pts[0], p)
		}
		body = map[string]any{"code": "Ok", "durations": [][]float64{durs}, "distances": [][]float64{dists}}
	case strings.HasPrefix(r.URL.Path, "/route/v1/driving/"):
		pts := parseCoords(r.URL.Path, "/route/v1/driving/")
		dist, dur := roadLeg(pts[0], pts[1])
		step := func(typ, mod, name string, at [2]float64, d, t float64) map[string]any {
			m := map[string]any{"type": typ, "location": []float64{at[1], at[0]}}
			if mod != "" {
				m["modifier"] = mod
			}
			return map[string]any{"name": name, "distance": d, "duration": t, "maneuver": m}
		}
		body = map[string]any{"code": "Ok", "routes": []any{map[string]any{
			"distance": dist, "duration": dur, "geometry": "_c`|@_c`|@_seK_seK",
			"legs": []any{map[string]any{"steps": []any{
				step("depart", "", "Rue 12.191", pts[0], dist/2, dur/2),
				step("end of road", "right", "Boulevard de la Marina", pts[0], dist/2, dur/2),
				step("arrive", "", "", pts[1], 0, 0),
			}}},
		}}}
	default:
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"InvalidUrl"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

// logBuffer capture tous les logs de l'application (test « aucune coordonnée dans les logs »).
type logBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *logBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *logBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// problems renvoie les lignes WARN et ERROR (affichées si les tests échouent).
func (b *logBuffer) problems() string {
	var out []string
	for _, l := range strings.Split(b.String(), "\n") {
		if strings.Contains(l, "level=WARN") || strings.Contains(l, "level=ERROR") {
			out = append(out, l)
		}
	}
	return strings.Join(out, "\n")
}
