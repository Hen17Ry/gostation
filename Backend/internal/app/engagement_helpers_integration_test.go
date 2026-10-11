//go:build integration

package app_test

import (
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"gostation/backend/internal/jobs"
)

// verifiedUser inscrit un utilisateur, vérifie son email et renvoie son client authentifié.
func verifiedUser(t *testing.T) (*client, session, string) {
	t.Helper()
	c := newClient(t)
	email := uniqueEmail("afi")
	s := registerUser(t, c, email)
	c.bearer = s.AccessToken
	code := latestCode(t, email, "Confirmez votre adresse")
	expect(t, c.do(http.MethodPost, "/api/v1/auth/verify-email", map[string]string{"email": email, "code": code}), http.StatusNoContent, "")
	return c, s, email
}

func newExpoToken() string {
	return "ExponentPushToken[" + strings.ReplaceAll(uuid.NewString(), "-", "")[:22] + "]"
}

type deviceResp struct {
	ID       string `json:"id"`
	Platform string `json:"platform"`
	Language string `json:"language"`
}

// registerDevice enregistre un appareil (nouvelle installation) sur la session du client.
func registerDevice(t *testing.T, c *client, lang string) (token string, d deviceResp) {
	t.Helper()
	token = newExpoToken()
	r := c.do(http.MethodPost, "/api/v1/me/devices", map[string]any{
		"token": token, "platform": "android", "installId": uuid.NewString(), "language": lang, "appVersion": "1.0.0",
	})
	expect(t, r, http.StatusOK, "")
	r.decode(t, &d)
	return token, d
}

// readyStation renvoie un gérant approuvé dont la station est épinglée en p, ouverte 24 h/24 et
// vend les produits donnés avec ces quantités.
func readyStation(t *testing.T, admin *client, p [2]float64, stock map[int16]int) (*client, string) {
	t.Helper()
	m, stationID := approvedManager(t, admin)
	expect(t, pin(t, m, p, nil), http.StatusOK, "")
	expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/opening-hours", etag(t, m, "/api/v1/manager/station/opening-hours"),
		map[string]any{"allWeek24h": true}), http.StatusOK, "")
	ids := make([]int16, 0, len(stock))
	for id := range stock {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/products", etag(t, m, "/api/v1/manager/station/products"),
		map[string]any{"productIds": ids}), http.StatusOK, "")
	expect(t, updateStocks(t, m, stock), http.StatusOK, "")
	return m, stationID
}

func updateStocks(t *testing.T, m *client, stock map[int16]int) response {
	t.Helper()
	items := make([]map[string]int, 0, len(stock))
	for id, q := range stock {
		items = append(items, map[string]int{"productId": int(id), "quantity": q})
	}
	return m.doIf(http.MethodPut, "/api/v1/manager/station/stocks", etag(t, m, "/api/v1/manager/station/stocks"), map[string]any{"items": items})
}

func confirmStocks(t *testing.T, m *client) response {
	t.Helper()
	return m.doIf(http.MethodPost, "/api/v1/manager/station/stocks/confirm", etag(t, m, "/api/v1/manager/station/stocks"), nil)
}

type inboxResp struct {
	Items []struct {
		ID     string         `json:"id"`
		Type   string         `json:"type"`
		Data   map[string]any `json:"data"`
		ReadAt *time.Time     `json:"readAt"`
	} `json:"items"`
	NextCursor  *string `json:"nextCursor"`
	UnreadCount int     `json:"unreadCount"`
}

func inbox(t *testing.T, c *client) inboxResp {
	t.Helper()
	r := c.do(http.MethodGet, "/api/v1/me/notifications?limit=100", nil)
	expect(t, r, http.StatusOK, "")
	var out inboxResp
	r.decode(t, &out)
	return out
}

// ofType filtre la boîte de réception par type (et par station si stationID n'est pas vide).
func (b inboxResp) ofType(typ, stationID string) []map[string]any {
	var out []map[string]any
	for _, it := range b.Items {
		if it.Type == typ && (stationID == "" || it.Data["stationId"] == stationID) {
			out = append(out, it.Data)
		}
	}
	return out
}

// drainQueues attend que le worker ait traité toutes les tâches en file (y compris différées).
func drainQueues(t *testing.T) {
	t.Helper()
	insp := asynq.NewInspectorFromRedisClient(it.rdb)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		busy := 0
		for q := range jobs.Queues() {
			info, err := insp.GetQueueInfo(q)
			if err != nil {
				continue // file jamais utilisée
			}
			busy += info.Pending + info.Active + info.Scheduled + info.Retry
		}
		if busy == 0 {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("task queues not drained")
}

// waitUntil attend qu'une condition devienne vraie (traitements asynchrones du worker).
func waitUntil(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// localTime renvoie une heure locale (Porto-Novo) du jour situé à days jours d'aujourd'hui.
func localTime(days, hour, minute int) time.Time {
	now := time.Now().In(it.cfg.Timezone)
	return time.Date(now.Year(), now.Month(), now.Day()+days, hour, minute, 0, 0, it.cfg.Timezone)
}

func newTestLogger(w *logBuffer) *slog.Logger {
	return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: slog.LevelDebug}))
}
