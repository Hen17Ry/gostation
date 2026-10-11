package push

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// expoServer simule l'Expo Push API.
type expoServer struct {
	mu       sync.Mutex
	batches  []int
	receipts []int
	auth     string
	failFrom int // à partir de ce lot (1, 2…), répond 429 ; 0 = jamais
}

func (e *expoServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.auth = r.Header.Get("Authorization")
	switch r.URL.Path {
	case "/--/api/v2/push/send":
		var msgs []Message
		if err := json.NewDecoder(r.Body).Decode(&msgs); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		e.batches = append(e.batches, len(msgs))
		if e.failFrom > 0 && len(e.batches) >= e.failFrom {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"errors":[{"code":"TOO_MANY_REQUESTS","message":"slow down, ` + msgs[0].To + `"}]}`))
			return
		}
		data := make([]map[string]any, len(msgs))
		for i, m := range msgs {
			if strings.Contains(m.To, "dead") {
				data[i] = map[string]any{"status": "error", "message": m.To + " is not registered", "details": map[string]any{"error": "DeviceNotRegistered"}}
				continue
			}
			data[i] = map[string]any{"status": "ok", "id": "t-" + m.To}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
	case "/--/api/v2/push/getReceipts":
		var req struct {
			IDs []string `json:"ids"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		e.receipts = append(e.receipts, len(req.IDs))
		data := map[string]any{}
		for _, id := range req.IDs {
			if strings.HasSuffix(id, "-gone") {
				data[id] = map[string]any{"status": "error", "message": "gone", "details": map[string]any{"error": "DeviceNotRegistered"}}
				continue
			}
			data[id] = map[string]any{"status": "ok"}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func newExpo(t *testing.T, srv *expoServer) *Expo {
	t.Helper()
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	e, err := NewExpo(ts.URL+"/", "secret-token", 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func messages(n int, token func(i int) string) []Message {
	out := make([]Message, n)
	for i := range out {
		out[i] = Message{To: token(i), Title: "t", Body: "b", Data: map[string]any{"type": "back_in_stock"}}
	}
	return out
}

func TestExpoSendsBatchesOf100(t *testing.T) {
	srv := &expoServer{}
	e := newExpo(t, srv)
	msgs := messages(250, func(i int) string {
		if i == 42 {
			return "ExponentPushToken[dead]"
		}
		return fmt.Sprintf("ExponentPushToken[%03d]", i)
	})
	tickets, err := e.Send(t.Context(), msgs)
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(srv.batches) != "[100 100 50]" || srv.auth != "Bearer secret-token" {
		t.Fatalf("batches = %v, auth = %q", srv.batches, srv.auth)
	}
	if len(tickets) != 250 || tickets[0].ID != "t-ExponentPushToken[000]" || tickets[249].ID == "" {
		t.Fatalf("tickets = %d, first %+v", len(tickets), tickets[0])
	}
	if dead := tickets[42]; dead.ID != "" || dead.Error != ErrDeviceNotRegistered {
		t.Fatalf("ticket for a dead token = %+v", dead)
	}
}

func TestExpoPartialFailureKeepsSentTickets(t *testing.T) {
	srv := &expoServer{failFrom: 2}
	e := newExpo(t, srv)
	tickets, err := e.Send(t.Context(), messages(150, func(i int) string { return fmt.Sprintf("ExponentPushToken[%03d]", i) }))
	if err == nil || !strings.Contains(err.Error(), "429") || !strings.Contains(err.Error(), "TOO_MANY_REQUESTS") {
		t.Fatalf("err = %v, want HTTP 429", err)
	}
	if len(tickets) != 100 {
		t.Fatalf("tickets = %d, want the 100 of the accepted batch", len(tickets))
	}
	if strings.Contains(err.Error(), "ExponentPushToken") {
		t.Errorf("error leaks a push token: %v", err)
	}
}

func TestExpoReceiptsInBatchesOf1000(t *testing.T) {
	srv := &expoServer{}
	e := newExpo(t, srv)
	ids := make([]string, 1500)
	for i := range ids {
		ids[i] = fmt.Sprintf("r-%d", i)
	}
	ids[7] = "r-7-gone"
	receipts, err := e.Receipts(t.Context(), ids)
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(srv.receipts) != "[1000 500]" || len(receipts) != 1500 {
		t.Fatalf("receipt batches = %v, receipts = %d", srv.receipts, len(receipts))
	}
	if r := receipts["r-7-gone"]; r.OK || r.Error != ErrDeviceNotRegistered {
		t.Fatalf("gone receipt = %+v", r)
	}
	if !receipts["r-0"].OK {
		t.Fatal("delivered receipt not OK")
	}
}

func TestExpoTransportErrorHasNoURL(t *testing.T) {
	e, err := NewExpo("http://127.0.0.1:1", "", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.Send(t.Context(), messages(1, func(int) string { return "ExponentPushToken[abc]" }))
	// Le *url.Error (méthode et URL complète) est retiré : seul l'hôte Expo peut apparaître.
	if err == nil || strings.Contains(err.Error(), "ExponentPushToken") || strings.Contains(err.Error(), "/--/api") || strings.Contains(err.Error(), "Post") {
		t.Fatalf("err = %v", err)
	}
}

func TestFakeAcceptsEverything(t *testing.T) {
	var buf strings.Builder
	f := NewFake(slog.New(slog.NewTextHandler(&buf, nil)))
	tickets, err := f.Send(t.Context(), messages(3, func(i int) string { return fmt.Sprintf("ExponentPushToken[%d]", i) }))
	if err != nil || len(tickets) != 3 || tickets[0].ID == tickets[1].ID {
		t.Fatalf("tickets = %+v, %v", tickets, err)
	}
	receipts, _ := f.Receipts(t.Context(), []string{tickets[0].ID})
	if !receipts[tickets[0].ID].OK {
		t.Fatal("fake receipt not OK")
	}
	if out := buf.String(); !strings.Contains(out, "type=back_in_stock") || !strings.Contains(out, "messages=3") || strings.Contains(out, "ExponentPushToken") {
		t.Fatalf("fake log = %q", out)
	}
}
