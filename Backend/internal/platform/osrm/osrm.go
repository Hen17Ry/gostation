// Package osrm est le client du serveur de routage OSRM auto-hébergé (profil car, MLD).
// Les appels /table et /route arriveront avec la recherche (étape 4).
package osrm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// probePoint est un point de Cotonou (lng,lat), utilisé pour vérifier que le jeu de données
// Bénin est chargé.
const probePoint = "2.4253,6.3703"

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

type response struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Ping vérifie qu'OSRM répond et que les données sont chargées (/nearest sur Cotonou).
func (c *Client) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	u := c.baseURL.JoinPath("nearest", "v1", "driving", probePoint)
	u.RawQuery = url.Values{"number": {"1"}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return fmt.Errorf("osrm: build request: %w", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("osrm: nearest: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	var body response
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return fmt.Errorf("osrm: nearest: decode response (status %d): %w", resp.StatusCode, err)
	}
	if resp.StatusCode != http.StatusOK || body.Code != "Ok" {
		return fmt.Errorf("osrm: nearest: status %d, code %q: %s", resp.StatusCode, body.Code, body.Message)
	}
	return nil
}
