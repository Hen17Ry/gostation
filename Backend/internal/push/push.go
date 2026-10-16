// Package push envoie les notifications push : interface Pusher, implémentation Expo Push API
// (lots de 100, lecture des reçus) et implémentation factice pour le développement et les tests.
//
// Aucune erreur ni aucun journal de ce paquet ne contient de token, de titre ni de corps de
// message : seulement des types, des nombres et des codes d'erreur Expo.
package push

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Tailles maximales des requêtes Expo.
const (
	BatchSize         = 100  // messages par envoi
	ReceiptsBatchSize = 1000 // identifiants par lecture de reçus
)

// ErrDeviceNotRegistered est le code Expo d'un token désinstallé ou expiré : on supprime l'appareil.
const ErrDeviceNotRegistered = "DeviceNotRegistered"

// Message est un push Expo (https://docs.expo.dev/push-notifications/sending-notifications/).
type Message struct {
	To         string         `json:"to"`
	Title      string         `json:"title,omitempty"`
	Body       string         `json:"body,omitempty"`
	Data       map[string]any `json:"data,omitempty"`
	CategoryID string         `json:"categoryId,omitempty"` // catégorie d'actions déclarée par l'app
	ChannelID  string         `json:"channelId,omitempty"`  // canal Android créé par l'app (son, importance)
	Sound      string         `json:"sound,omitempty"`
	Priority   string         `json:"priority,omitempty"` // default | normal | high
	TTL        int            `json:"ttl,omitempty"`      // secondes
	// ContentAvailable sans titre ni texte : message de données (Android : réveille la tâche de
	// l'app, même tuée, qui présente elle-même la notification).
	ContentAvailable bool `json:"_contentAvailable,omitempty"`
}

// Ticket est la réponse d'Expo pour un message : un identifiant de reçu, ou une erreur immédiate.
type Ticket struct {
	ID      string
	Error   string // code Expo (DeviceNotRegistered, MessageTooBig…) ; vide si accepté
	Message string
}

// Receipt est le résultat final de livraison d'un ticket.
type Receipt struct {
	OK      bool
	Error   string
	Message string
}

// Pusher envoie des push et lit leurs reçus.
type Pusher interface {
	// Send envoie les messages par lots de BatchSize et renvoie un ticket par message, dans
	// l'ordre. En cas d'erreur, les tickets couvrent les messages des lots déjà acceptés.
	Send(ctx context.Context, msgs []Message) ([]Ticket, error)
	// Receipts lit les reçus des tickets (absents de la map : pas encore disponibles).
	Receipts(ctx context.Context, ids []string) (map[string]Receipt, error)
}

// ── Expo ─────────────────────────────────────────────────────────────────────

// Expo parle à l'Expo Push API.
type Expo struct {
	sendURL     string
	receiptsURL string
	token       string
	hc          *http.Client
}

// NewExpo construit le client. baseURL vaut https://exp.host en production (un serveur simulé
// dans les tests) ; accessToken active la sécurité renforcée des push Expo.
func NewExpo(baseURL, accessToken string, timeout time.Duration) (*Expo, error) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("push: invalid Expo URL")
	}
	base := u.String()
	return &Expo{
		sendURL:     base + "/--/api/v2/push/send",
		receiptsURL: base + "/--/api/v2/push/getReceipts",
		token:       accessToken,
		hc:          &http.Client{Timeout: timeout},
	}, nil
}

type expoError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type expoDetails struct {
	Error string `json:"error"`
}

type expoTicket struct {
	Status  string      `json:"status"`
	ID      string      `json:"id"`
	Message string      `json:"message"`
	Details expoDetails `json:"details"`
}

// post envoie une requête JSON. L'erreur ne reprend jamais le corps envoyé.
func (e *Expo) post(ctx context.Context, endpoint string, body, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("push: encode request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("push: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if e.token != "" {
		req.Header.Set("Authorization", "Bearer "+e.token)
	}
	resp, err := e.hc.Do(req)
	if err != nil {
		var uerr *url.Error
		if errors.As(err, &uerr) {
			err = uerr.Err
		}
		return fmt.Errorf("push: expo request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return fmt.Errorf("push: read expo response: %w", err)
	}
	var envelope struct {
		Data   json.RawMessage `json:"data"`
		Errors []expoError     `json:"errors"`
	}
	_ = json.Unmarshal(data, &envelope)
	if resp.StatusCode != http.StatusOK || len(envelope.Errors) > 0 {
		codes := make([]string, 0, len(envelope.Errors))
		for _, e := range envelope.Errors {
			codes = append(codes, e.Code)
		}
		return fmt.Errorf("push: expo HTTP %d %s", resp.StatusCode, strings.Join(codes, ","))
	}
	if err := json.Unmarshal(envelope.Data, out); err != nil {
		return fmt.Errorf("push: decode expo response: %w", err)
	}
	return nil
}

// Send envoie les messages par lots de 100.
func (e *Expo) Send(ctx context.Context, msgs []Message) ([]Ticket, error) {
	out := make([]Ticket, 0, len(msgs))
	for start := 0; start < len(msgs); start += BatchSize {
		batch := msgs[start:min(start+BatchSize, len(msgs))]
		var tickets []expoTicket
		if err := e.post(ctx, e.sendURL, batch, &tickets); err != nil {
			return out, err
		}
		if len(tickets) != len(batch) {
			return out, fmt.Errorf("push: expo returned %d tickets for %d messages", len(tickets), len(batch))
		}
		for _, t := range tickets {
			tk := Ticket{ID: t.ID}
			if t.Status != "ok" {
				tk.ID, tk.Error, tk.Message = "", t.Details.Error, t.Message
				if tk.Error == "" {
					tk.Error = "Unknown"
				}
			}
			out = append(out, tk)
		}
	}
	return out, nil
}

// Receipts lit les reçus par lots de 1 000.
func (e *Expo) Receipts(ctx context.Context, ids []string) (map[string]Receipt, error) {
	out := make(map[string]Receipt, len(ids))
	for start := 0; start < len(ids); start += ReceiptsBatchSize {
		batch := ids[start:min(start+ReceiptsBatchSize, len(ids))]
		var receipts map[string]expoTicket
		if err := e.post(ctx, e.receiptsURL, map[string][]string{"ids": batch}, &receipts); err != nil {
			return out, err
		}
		for id, r := range receipts {
			out[id] = Receipt{OK: r.Status == "ok", Error: r.Details.Error, Message: r.Message}
		}
	}
	return out, nil
}

// ── Factice ──────────────────────────────────────────────────────────────────

// Fake remplace Expo en développement et dans les tests (EXPO_ACCESS_TOKEN vide) : il journalise
// le type de notification et le nombre de messages, sans aucune donnée personnelle (ni token, ni
// titre, ni corps), et accepte tout.
type Fake struct {
	log *slog.Logger
	seq atomic.Int64
}

// NewFake construit le Pusher factice.
func NewFake(log *slog.Logger) *Fake { return &Fake{log: log} }

// Send accepte tous les messages.
func (f *Fake) Send(ctx context.Context, msgs []Message) ([]Ticket, error) {
	byType := map[string]int{}
	out := make([]Ticket, len(msgs))
	for i, m := range msgs {
		typ, _ := m.Data["type"].(string)
		byType[typ]++
		out[i] = Ticket{ID: "fake-" + strconv.FormatInt(f.seq.Add(1), 10)}
	}
	for typ, n := range byType {
		f.log.InfoContext(ctx, "push: fake delivery", slog.String("type", typ), slog.Int("messages", n))
	}
	return out, nil
}

// Receipts déclare tous les tickets livrés.
func (f *Fake) Receipts(_ context.Context, ids []string) (map[string]Receipt, error) {
	out := make(map[string]Receipt, len(ids))
	for _, id := range ids {
		out[id] = Receipt{OK: true}
	}
	return out, nil
}
