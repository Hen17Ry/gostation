//go:build integration

package app_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gostation/backend/internal/mail"
	"gostation/backend/internal/push"
)

// fakeExpo imite l'Expo Push API : /push/send (tickets) et /push/getReceipts. Un token marqué
// « mort » reçoit un ticket accepté puis un reçu DeviceNotRegistered, comme un appareil
// désinstallé.
type fakeExpo struct {
	mu       sync.Mutex
	messages []push.Message
	batches  []int
	tickets  map[string]string // ticket → token
	dead     map[string]bool
	receipts [][]string
	auth     map[string]bool
	seq      int
}

func newFakeExpo() *fakeExpo {
	return &fakeExpo{tickets: map[string]string{}, dead: map[string]bool{}, auth: map[string]bool{}}
}

func (f *fakeExpo) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.auth[r.Header.Get("Authorization")] = true
	w.Header().Set("Content-Type", "application/json")
	switch r.URL.Path {
	case "/--/api/v2/push/send":
		var msgs []push.Message
		if err := json.NewDecoder(r.Body).Decode(&msgs); err != nil || len(msgs) > push.BatchSize {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"errors":[{"code":"VALIDATION_ERROR","message":"bad request"}]}`))
			return
		}
		f.batches = append(f.batches, len(msgs))
		tickets := make([]map[string]any, len(msgs))
		for i, m := range msgs {
			f.seq++
			id := "ticket-" + strconv.Itoa(f.seq)
			f.tickets[id] = m.To
			f.messages = append(f.messages, m)
			tickets[i] = map[string]any{"status": "ok", "id": id}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": tickets})
	case "/--/api/v2/push/getReceipts":
		var req struct {
			IDs []string `json:"ids"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		f.receipts = append(f.receipts, req.IDs)
		out := map[string]any{}
		for _, id := range req.IDs {
			if f.dead[f.tickets[id]] {
				out[id] = map[string]any{"status": "error", "message": "not registered", "details": map[string]any{"error": "DeviceNotRegistered"}}
				continue
			}
			out[id] = map[string]any{"status": "ok"}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": out})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func (f *fakeExpo) markDead(token string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.dead[token] = true
}

// to renvoie les messages reçus pour un token.
func (f *fakeExpo) to(token string) []push.Message {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []push.Message
	for _, m := range f.messages {
		if m.To == token {
			out = append(out, m)
		}
	}
	return out
}

// waitFor attend qu'un token ait reçu au moins n messages (le worker est asynchrone).
func (f *fakeExpo) waitFor(t *testing.T, token string, n int) []push.Message {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if msgs := f.to(token); len(msgs) >= n {
			return msgs
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("token received %d push messages, want %d", len(f.to(token)), n)
	return nil
}

// ── Horloge réglable ────────────────────────────────────────────────────────

// testClock est l'horloge des rappels et des alertes favoris : l'heure réelle par défaut, ou
// une heure fixée par un test (remise à zéro à la fin du test).
type testClock struct {
	fixed atomic.Pointer[time.Time]
}

func (c *testClock) Now() time.Time {
	if f := c.fixed.Load(); f != nil {
		return *f
	}
	return time.Now()
}

func setClock(t *testing.T, at time.Time) {
	t.Helper()
	it.clock.fixed.Store(&at)
	t.Cleanup(func() { it.clock.fixed.Store(nil) })
}

// freezeMidWindow fige l'horloge au milieu d'une minute, pour les tests qui comptent un quota à
// la requête près. Le limiteur estime une fenêtre glissante à partir de deux fenêtres fixes : une
// rafale de plusieurs secondes à cheval sur un changement de minute est sous-estimée d'une requête
// ou deux (approximation assumée), et le test échouait selon l'heure de son lancement.
func freezeMidWindow(t *testing.T) {
	t.Helper()
	setClock(t, time.Now().Truncate(time.Minute).Add(30*time.Second))
}

// ── SMTP capricieux ─────────────────────────────────────────────────────────

// flakyMailer fait échouer les premiers envois vers une adresse (retry des emails via asynq).
type flakyMailer struct {
	next     mail.Mailer
	mu       sync.Mutex
	failures map[string]int
	attempts map[string]int
}

func (f *flakyMailer) failNext(to string, n int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failures[to] = n
}

func (f *flakyMailer) attemptsFor(to string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.attempts[to]
}

func (f *flakyMailer) Send(ctx context.Context, m mail.Message) error {
	f.mu.Lock()
	f.attempts[m.To]++
	fail := f.failures[m.To] > 0
	if fail {
		f.failures[m.To]--
	}
	f.mu.Unlock()
	if fail {
		return errors.New("smtp: temporary failure (test)")
	}
	return f.next.Send(ctx, m)
}
