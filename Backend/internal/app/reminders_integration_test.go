//go:build integration

package app_test

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"gostation/backend/internal/notification"
)

type reminderRow struct {
	sent, streak int
	stopped      bool
	lastSentAt   *time.Time
	mutedUntil   *time.Time
}

func reminderState(t *testing.T, stationID string) reminderRow {
	t.Helper()
	var r reminderRow
	err := it.pool.QueryRow(t.Context(), `SELECT sent, streak, stopped, last_sent_at, muted_until FROM station_reminders WHERE station_id = $1`,
		stationID).Scan(&r.sent, &r.streak, &r.stopped, &r.lastSentAt, &r.mutedUntil)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal(err)
	}
	return r
}

func setLastUpdate(t *testing.T, stationID string, at time.Time) {
	t.Helper()
	if _, err := it.pool.Exec(t.Context(), `UPDATE stations SET last_stock_update_at = $2 WHERE id = $1`, stationID, at); err != nil {
		t.Fatal(err)
	}
}

// scanAt lance un passage des rappels à l'heure donnée.
func scanAt(t *testing.T, at time.Time) {
	t.Helper()
	setClock(t, at)
	if _, err := it.svc.Reminders.Scan(t.Context()); err != nil {
		t.Fatal(err)
	}
}

// expectSent vérifie le nombre de rappels du jour et l'heure du dernier.
func expectSent(t *testing.T, stationID string, sent int, last time.Time) {
	t.Helper()
	st := reminderState(t, stationID)
	if st.sent != sent || st.lastSentAt == nil || !st.lastSentAt.Equal(last) {
		t.Fatalf("reminder state = sent %d, last %v; want sent %d, last %s", st.sent, st.lastSentAt, sent, last)
	}
}

func setHours(t *testing.T, m *client, opens, closes string) {
	t.Helper()
	days := make([]map[string]any, 0, 7)
	for d := 1; d <= 7; d++ {
		days = append(days, map[string]any{"weekday": d, "ranges": []map[string]string{{"opens": opens, "closes": closes}}})
	}
	expect(t, m.doIf(http.MethodPut, "/api/v1/manager/station/opening-hours", etag(t, m, "/api/v1/manager/station/opening-hours"),
		map[string]any{"days": days}), http.StatusOK, "")
}

func openAlerts(t *testing.T, admin *client, kind, stationID string) int {
	t.Helper()
	var page struct {
		Items []struct {
			Kind    string `json:"kind"`
			Station struct {
				ID string `json:"id"`
			} `json:"station"`
		} `json:"items"`
	}
	r := admin.do(http.MethodGet, "/api/v1/admin/alerts?status=open&limit=100&kind="+kind, nil)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &page)
	n := 0
	for _, a := range page.Items {
		if a.Station.ID == stationID {
			n++
		}
	}
	return n
}

func TestStockReminders(t *testing.T) {
	admin := adminClient(t)
	gas := productID(t, "lpg_10kg")
	day := func(days, h, m int) time.Time { return localTime(days+3, h, m) } // journée fixe, à J+3

	t.Run("open station, 4 h without update, confirm action", func(t *testing.T) {
		m, stationID := readyStation(t, admin, calavi, map[int16]int{gas: 5})
		token, _ := registerDeviceOn(t, m, "fr", "android")

		setLastUpdate(t, stationID, day(0, 2, 0))
		scanAt(t, day(0, 3, 0)) // mise à jour il y a 1 h : rien
		if st := reminderState(t, stationID); st.sent != 0 {
			t.Fatalf("reminder sent 1 h after an update: %+v", st)
		}
		scanAt(t, day(0, 6, 0))
		expectSent(t, stationID, 1, day(0, 6, 0))
		msg := it.expo.waitFor(t, token, 1)[0]
		// Appareil Android : message de données, présenté par l'app avec ses actions (D75).
		if msg.Title != "" || !msg.ContentAvailable || msg.ChannelID != "" || msg.Priority != "high" ||
			msg.Data["type"] != "stock_reminder" || msg.Data["hoursSinceUpdate"] != float64(4) ||
			msg.Data["channelId"] != notification.ChannelStockReminders {
			t.Fatalf("reminder push = %+v", msg)
		}
		actions, _ := msg.Data["actions"].([]any)
		if len(actions) != 2 {
			t.Fatalf("reminder actions = %v", msg.Data["actions"])
		}
		confirm, _ := actions[1].(map[string]any)
		if confirm["id"] != notification.ActionConfirm || confirm["path"] != notification.ConfirmPath || confirm["opensApp"] != false {
			t.Fatalf("confirm action = %v", confirm)
		}
		if got := inbox(t, m).ofType("stock_reminder", stationID); len(got) != 1 || got[0]["etag"] != confirm["ifMatch"] {
			t.Fatalf("inbox reminders = %v", got)
		}

		scanAt(t, day(0, 6, 15)) // dernier rappel il y a 15 min : rien
		expectSent(t, stationID, 1, day(0, 6, 0))

		// « Rien n'a changé » depuis la notification : If-Match du push, sans recharger la station.
		ifMatch, _ := confirm["ifMatch"].(string)
		expect(t, m.doIf(http.MethodPost, confirm["path"].(string), ifMatch, nil), http.StatusOK, "")
		if st := reminderState(t, stationID); st.streak != 0 {
			t.Fatalf("confirmation did not reset the ignored streak: %+v", st)
		}
		setLastUpdate(t, stationID, day(0, 7, 0)) // confirmation ramenée sur la journée simulée
		scanAt(t, day(0, 10, 0))                  // confirmée il y a 3 h : rien
		expectSent(t, stationID, 1, day(0, 6, 0))
		scanAt(t, day(0, 11, 5)) // 4 h 05 après la confirmation : rappel
		expectSent(t, stationID, 2, day(0, 11, 5))
	})

	t.Run("closed station gets no reminder", func(t *testing.T) {
		m, stationID := readyStation(t, admin, parakou, map[int16]int{gas: 5})
		setHours(t, m, "06:00", "07:00")
		setLastUpdate(t, stationID, day(-1, 20, 0))
		scanAt(t, day(0, 12, 0))
		if st := reminderState(t, stationID); st.sent != 0 {
			t.Fatalf("closed station reminded: %+v", st)
		}
		scanAt(t, day(0, 6, 30))
		expectSent(t, stationID, 1, day(0, 6, 30))
	})

	t.Run("at most 4 reminders a day", func(t *testing.T) {
		m, stationID := readyStation(t, admin, bohicon, map[int16]int{gas: 5})
		setLastUpdate(t, stationID, day(-1, 23, 0))
		// Le gérant confirme après chaque rappel (série jamais « ignorée ») : seul le plafond joue.
		for i, at := range []time.Time{day(0, 6, 0), day(0, 10, 1), day(0, 14, 2), day(0, 18, 3)} {
			scanAt(t, at)
			expectSent(t, stationID, i+1, at)
			expect(t, confirmStocks(t, m), http.StatusOK, "")
		}
		scanAt(t, day(0, 22, 4))
		expectSent(t, stationID, 4, day(0, 18, 3))
		scanAt(t, day(1, 2, 5)) // lendemain : compteur remis à zéro
		expectSent(t, stationID, 1, day(1, 2, 5))
		if openAlerts(t, admin, "manager_inactive", stationID) != 0 {
			t.Error("manager flagged inactive although they answered every reminder")
		}
	})

	t.Run("3 ignored reminders: stop for the day, email, admin alert", func(t *testing.T) {
		m, stationID := readyStation(t, admin, offset(calavi, 3000), map[int16]int{gas: 5})
		token, _ := registerDevice(t, m, "fr")
		email := managerEmail(t, stationID)
		setLastUpdate(t, stationID, day(-1, 23, 0))
		for i, at := range []time.Time{day(0, 6, 0), day(0, 10, 1), day(0, 14, 2)} {
			scanAt(t, at)
			expectSent(t, stationID, i+1, at)
		}
		scanAt(t, day(0, 18, 3)) // 4e échéance : escalade au lieu d'un 4e rappel
		st := reminderState(t, stationID)
		if !st.stopped || st.streak != 0 || st.sent != 3 {
			t.Fatalf("after 3 ignored reminders: %+v", st)
		}
		if _, err := it.mailpit.WaitFor(t.Context(), email, "Rappels suspendus"); err != nil {
			t.Fatal(err)
		}
		if openAlerts(t, admin, "manager_inactive", stationID) != 1 {
			t.Fatal("no manager_inactive alert for the admin")
		}
		scanAt(t, day(0, 22, 4)) // arrêt pour la journée
		expectSent(t, stationID, 3, day(0, 14, 2))
		drainQueues(t)
		if n := len(it.expo.to(token)); n != 3 {
			t.Fatalf("manager received %d reminder pushes, want 3", n)
		}

		scanAt(t, day(1, 6, 0)) // reprise le lendemain
		expectSent(t, stationID, 1, day(1, 6, 0))
		if st := reminderState(t, stationID); st.stopped {
			t.Fatal("reminders still stopped the next day")
		}
		// Une mise à jour du gérant lève l'alerte « gérant inactif ».
		expect(t, updateStocks(t, m, map[int16]int{gas: 6}), http.StatusOK, "")
		if openAlerts(t, admin, "manager_inactive", stationID) != 0 {
			t.Error("manager_inactive alert still open after a stock update")
		}
	})

	t.Run("mute until closing time", func(t *testing.T) {
		m, stationID := readyStation(t, admin, offset(parakou, 3000), map[int16]int{gas: 5})
		setHours(t, m, "06:00", "22:00")
		setLastUpdate(t, stationID, day(0, 1, 0))
		setClock(t, day(0, 12, 0))
		r := m.do(http.MethodPost, "/api/v1/manager/reminders/mute", nil)
		expect(t, r, http.StatusOK, "")
		var mute struct {
			MutedUntil time.Time `json:"mutedUntil"`
		}
		r.decode(t, &mute)
		if !mute.MutedUntil.Equal(day(0, 22, 0)) {
			t.Fatalf("mutedUntil = %s, want %s", mute.MutedUntil, day(0, 22, 0))
		}
		scanAt(t, day(0, 12, 0))
		scanAt(t, day(0, 21, 30))
		if st := reminderState(t, stationID); st.sent != 0 {
			t.Fatalf("muted station reminded: %+v", st)
		}
		scanAt(t, day(1, 6, 0))
		expectSent(t, stationID, 1, day(1, 6, 0))
	})

	t.Run("opt-out", func(t *testing.T) {
		m, stationID := readyStation(t, admin, offset(bohicon, 3000), map[int16]int{gas: 5})
		expect(t, m.do(http.MethodPut, "/api/v1/me/notification-settings",
			map[string]any{"settings": []map[string]any{{"type": "stock_reminder", "enabled": false}}}), http.StatusOK, "")
		setLastUpdate(t, stationID, day(-1, 20, 0))
		scanAt(t, day(0, 9, 0))
		if st := reminderState(t, stationID); st.sent != 0 {
			t.Fatalf("opted-out manager reminded: %+v", st)
		}
	})
}
