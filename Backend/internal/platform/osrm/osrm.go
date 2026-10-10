// Package osrm est le client du serveur de routage OSRM auto-hébergé (profil car, MLD).
//
// Confidentialité : les URL OSRM contiennent des coordonnées (dont la position de l'utilisateur).
// Aucune erreur renvoyée par ce paquet ne contient l'URL : les *url.Error de net/http sont
// remplacées par leur cause, sans l'adresse.
package osrm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// probePoint est un point de Cotonou (lng,lat), utilisé pour vérifier que le jeu de données
// Bénin est chargé.
const probePoint = "2.4253,6.3703"

// Point est une coordonnée.
type Point struct {
	Lat float64
	Lng float64
}

func (p Point) String() string {
	return strconv.FormatFloat(p.Lng, 'f', 6, 64) + "," + strconv.FormatFloat(p.Lat, 'f', 6, 64)
}

// Client appelle OSRM avec un timeout par requête.
type Client struct {
	baseURL *url.URL
	http    *http.Client
	timeout time.Duration
}

// New construit le client. timeout borne chaque appel (OSRM_TIMEOUT).
func New(baseURL string, timeout time.Duration) (*Client, error) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("osrm: invalid base URL %q", baseURL)
	}
	if timeout <= 0 {
		return nil, errors.New("osrm: timeout must be positive")
	}
	return &Client{
		baseURL: u,
		http: &http.Client{
			Timeout: timeout,
			Transport: &http.Transport{
				MaxIdleConns:        64,
				MaxIdleConnsPerHost: 32,
				IdleConnTimeout:     90 * time.Second,
			},
		},
		timeout: timeout,
	}, nil
}

// ErrNoRoute signale qu'aucun itinéraire routier n'existe entre les points.
var ErrNoRoute = errors.New("osrm: no route")

type envelope struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// call exécute un GET sur path (déjà échappé) et décode la réponse dans out. Les erreurs ne
// contiennent jamais l'URL appelée.
func (c *Client) call(ctx context.Context, op, path string, query url.Values, out any) error {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	u := *c.baseURL
	u.Path = strings.TrimRight(u.Path, "/") + path
	u.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return fmt.Errorf("osrm: %s: build request failed", op)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		var uerr *url.Error
		if errors.As(err, &uerr) {
			err = uerr.Err // sans l'URL (qui porte des coordonnées)
		}
		return fmt.Errorf("osrm: %s: %w", op, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return fmt.Errorf("osrm: %s: read response: %w", op, err)
	}
	var env envelope
	if err := json.Unmarshal(body, &env); err != nil {
		return fmt.Errorf("osrm: %s: decode response (status %d): %w", op, resp.StatusCode, err)
	}
	if env.Code == "NoRoute" || env.Code == "NoSegment" {
		return ErrNoRoute
	}
	if resp.StatusCode != http.StatusOK || env.Code != "Ok" {
		return fmt.Errorf("osrm: %s: status %d, code %q", op, resp.StatusCode, env.Code)
	}
	if out != nil {
		if err := json.Unmarshal(body, out); err != nil {
			return fmt.Errorf("osrm: %s: decode response: %w", op, err)
		}
	}
	return nil
}

// Ping vérifie qu'OSRM répond et que les données sont chargées (/nearest sur Cotonou).
func (c *Client) Ping(ctx context.Context) error {
	return c.call(ctx, "nearest", "/nearest/v1/driving/"+probePoint, url.Values{"number": {"1"}}, nil)
}

// Leg est le trajet routier vers une destination ; nil si elle n'est pas joignable par la route.
type Leg struct {
	DurationS float64
	DistanceM float64
}

// Table calcule les trajets depuis from vers chaque destination (une source, N destinations).
// Le résultat a la même longueur que dests ; un élément nil = non joignable.
func (c *Client) Table(ctx context.Context, from Point, dests []Point) ([]*Leg, error) {
	if len(dests) == 0 {
		return nil, nil
	}
	coords := make([]string, 0, len(dests)+1)
	coords = append(coords, from.String())
	for _, d := range dests {
		coords = append(coords, d.String())
	}
	var res struct {
		Durations [][]*float64 `json:"durations"`
		Distances [][]*float64 `json:"distances"`
	}
	q := url.Values{"sources": {"0"}, "annotations": {"duration,distance"}}
	if err := c.call(ctx, "table", "/table/v1/driving/"+strings.Join(coords, ";"), q, &res); err != nil {
		return nil, err
	}
	if len(res.Durations) != 1 || len(res.Durations[0]) != len(dests)+1 || len(res.Distances) != 1 {
		return nil, errors.New("osrm: table: unexpected response shape")
	}
	out := make([]*Leg, len(dests))
	for i := range dests {
		dur, dist := res.Durations[0][i+1], res.Distances[0][i+1]
		if dur != nil && dist != nil {
			out[i] = &Leg{DurationS: *dur, DistanceM: *dist}
		}
	}
	return out, nil
}

// Step est une étape d'itinéraire, sans texte : le mobile la traduit (osrm-text-instructions).
type Step struct {
	Type      string // type de manœuvre OSRM (turn, end of road, roundabout, arrive…)
	Modifier  string // left, slight right, uturn…
	Exit      int    // sortie de rond-point
	Name      string
	Ref       string
	DistanceM float64
	DurationS float64
	Location  Point // point de la manœuvre
}

// Route est un itinéraire.
type Route struct {
	DistanceM float64
	DurationS float64
	Geometry  string // polyline6
	Steps     []Step
}

// Route calcule l'itinéraire from → to (polyline6, overview=full, steps=true).
func (c *Client) Route(ctx context.Context, from, to Point) (Route, error) {
	var res struct {
		Routes []struct {
			Distance float64 `json:"distance"`
			Duration float64 `json:"duration"`
			Geometry string  `json:"geometry"`
			Legs     []struct {
				Steps []struct {
					Name     string  `json:"name"`
					Ref      string  `json:"ref"`
					Distance float64 `json:"distance"`
					Duration float64 `json:"duration"`
					Maneuver struct {
						Type     string    `json:"type"`
						Modifier string    `json:"modifier"`
						Exit     int       `json:"exit"`
						Location []float64 `json:"location"`
					} `json:"maneuver"`
				} `json:"steps"`
			} `json:"legs"`
		} `json:"routes"`
	}
	q := url.Values{"overview": {"full"}, "geometries": {"polyline6"}, "steps": {"true"}}
	if err := c.call(ctx, "route", "/route/v1/driving/"+from.String()+";"+to.String(), q, &res); err != nil {
		return Route{}, err
	}
	if len(res.Routes) == 0 {
		return Route{}, ErrNoRoute
	}
	r := res.Routes[0]
	out := Route{DistanceM: r.Distance, DurationS: r.Duration, Geometry: r.Geometry}
	for _, leg := range r.Legs {
		for _, s := range leg.Steps {
			st := Step{
				Type: s.Maneuver.Type, Modifier: s.Maneuver.Modifier, Exit: s.Maneuver.Exit, Name: s.Name,
				Ref: s.Ref, DistanceM: s.Distance, DurationS: s.Duration,
			}
			if len(s.Maneuver.Location) == 2 {
				st.Location = Point{Lng: s.Maneuver.Location[0], Lat: s.Maneuver.Location[1]}
			}
			out.Steps = append(out.Steps, st)
		}
	}
	return out, nil
}
