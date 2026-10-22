package errtrack_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/getsentry/sentry-go"

	"gostation/backend/internal/platform/errtrack"
)

// Données qui ne doivent jamais quitter le serveur (règle 2, D90).
var secrets = []string{
	"awa.houngbo@example.bj",                    // email
	"eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiIxIn0.c2ln", // JWT
	"gsr_Zm9vYmFyYmF6cXV4", "gsm_ZGVmaQ",        // refresh token, défi 2FA
	"ExponentPushToken[xxxxABCD]", // token push
	"Bearer abc.def",              // en-tête d'autorisation
	"6.3703", "2.4253", "-6.5",    // coordonnées
	"203.0.113.7", "2001:db8:1:2::1", // IP
	"+22997000000",        // téléphone
	"mot-de-passe-secret", // corps de requête
	"gs_at=cookie",        // cookie
}

func leaky() *sentry.Event {
	return &sentry.Event{
		Message: "user awa.houngbo@example.bj at lat=6.3703&lng=2.4253 from 203.0.113.7",
		Exception: []sentry.Exception{{
			Type:  "*fmt.wrapError",
			Value: `search: osrm: GET /table/v1/driving/2.4253,6.3703 (token eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiIxIn0.c2ln, gsr_Zm9vYmFyYmF6cXV4, gsm_ZGVmaQ) "lat": -6.5 phone +22997000000 via 2001:db8:1:2::1 at 12:30:45`,
		}},
		Request: &sentry.Request{
			URL: "https://api.gostation.bj/api/v1/search?lat=6.3703&lng=2.4253", QueryString: "lat=6.3703&lng=2.4253",
			Data: `{"password":"mot-de-passe-secret"}`, Cookies: "gs_at=cookie",
			Headers: map[string]string{"Authorization": "Bearer abc.def"}, Env: map[string]string{"REMOTE_ADDR": "203.0.113.7"},
		},
		User:        sentry.User{ID: "u1", Email: "awa.houngbo@example.bj", IPAddress: "203.0.113.7"},
		Breadcrumbs: []*sentry.Breadcrumb{{Message: "GET /search?lat=6.3703&lng=2.4253"}},
		Tags:        map[string]string{"route": "/api/v1/search", "push": "ExponentPushToken[xxxxABCD]"},
		Contexts:    map[string]sentry.Context{"os": {"name": "linux"}, "request_body": {"password": "mot-de-passe-secret"}},
	}
}

func assertClean(t *testing.T, e *sentry.Event) {
	t.Helper()
	raw, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	out := string(raw)
	for _, s := range secrets {
		if strings.Contains(out, s) {
			t.Errorf("event leaks %q: %s", s, out)
		}
	}
	// Ce qui sert au diagnostic reste lisible.
	for _, keep := range []string{"/api/v1/search", "search: osrm", "12:30:45", `"os"`} {
		if !strings.Contains(out, keep) {
			t.Errorf("event lost %q: %s", keep, out)
		}
	}
}

func TestScrubRemovesPersonalData(t *testing.T) {
	assertClean(t, errtrack.Scrub(leaky()))
}

type transport struct {
	mu     sync.Mutex
	events []*sentry.Event
}

func (f *transport) Configure(sentry.ClientOptions) {}
func (f *transport) SendEvent(e *sentry.Event) {
	f.mu.Lock()
	f.events = append(f.events, e)
	f.mu.Unlock()
}
func (f *transport) Flush(time.Duration) bool              { return true }
func (f *transport) FlushWithContext(context.Context) bool { return true }
func (f *transport) Close()                                {}

// Bout en bout : ce que le SDK enverrait passe par Scrub, quel que soit ce que l'appelant met
// dans l'erreur et les tags.
func TestReportSendsOnlyScrubbedEvents(t *testing.T) {
	tr := &transport{}
	tk, err := errtrack.New(errtrack.Config{
		DSN: "https://public@glitchtip.example/1", Environment: "test", Service: "api", Transport: tr,
	})
	if err != nil {
		t.Fatal(err)
	}
	e := leaky()
	tk.Report(context.Background(), errors.New(e.Exception[0].Value), map[string]string{"route": "/api/v1/search", "email": "awa.houngbo@example.bj"})
	tk.Flush(time.Second)
	if len(tr.events) != 1 {
		t.Fatalf("%d events sent, want 1", len(tr.events))
	}
	got := tr.events[0]
	if got.Tags["service"] != "api" || got.Request != nil || got.User.IPAddress != "" {
		t.Errorf("event = %+v", got)
	}
	raw, _ := json.Marshal(got)
	for _, s := range secrets {
		if strings.Contains(string(raw), s) {
			t.Errorf("sent event leaks %q", s)
		}
	}
}

// Sans DSN : rien n'est envoyé, et un Tracker nil ne panique pas.
func TestDisabledWithoutDSN(t *testing.T) {
	tk, err := errtrack.New(errtrack.Config{})
	if err != nil || tk.Enabled() {
		t.Fatalf("tracker without DSN: enabled=%v err=%v", tk.Enabled(), err)
	}
	tk.Report(context.Background(), errors.New("boom"), nil)
	var none *errtrack.Tracker
	none.Report(context.Background(), errors.New("boom"), nil)
	none.Flush(time.Millisecond)
}

// Événement de test des commandes errtrack-test : un message étiqueté par service, refusé sans DSN.
func TestSendTest(t *testing.T) {
	tr := &transport{}
	tk, err := errtrack.New(errtrack.Config{
		DSN: "https://public@glitchtip.example/1", Environment: "staging", Service: "worker", Transport: tr,
	})
	if err != nil {
		t.Fatal(err)
	}
	id, err := tk.SendTest("worker", time.Second)
	if err != nil || id == "" {
		t.Fatalf("SendTest = %q, %v", id, err)
	}
	if len(tr.events) != 1 || tr.events[0].Message != "GlitchTip test event (worker)" ||
		tr.events[0].Tags["service"] != "worker" || tr.events[0].Environment != "staging" {
		t.Fatalf("events = %+v", tr.events)
	}
	off, _ := errtrack.New(errtrack.Config{})
	if _, err := off.SendTest("api", time.Millisecond); err == nil {
		t.Fatal("SendTest without DSN must fail")
	}
}
