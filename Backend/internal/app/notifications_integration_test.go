//go:build integration

package app_test

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/auth"
	"gostation/backend/internal/notification"
	"gostation/backend/internal/push"
	"gostation/backend/internal/store/dbgen"
)

func deviceExists(t *testing.T, id string) bool {
	t.Helper()
	var n int
	if err := it.pool.QueryRow(t.Context(), `SELECT count(*) FROM device_tokens WHERE id = $1`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n == 1
}

func currentSessionID(t *testing.T, c *client) string {
	t.Helper()
	var sessions struct {
		Items []struct {
			ID      string `json:"id"`
			Current bool   `json:"current"`
		} `json:"items"`
	}
	c.do(http.MethodGet, "/api/v1/me/sessions", nil).decode(t, &sessions)
	for _, s := range sessions.Items {
		if s.Current {
			return s.ID
		}
	}
	t.Fatal("no current session")
	return ""
}

// TestDevicesFollowSessions : un appareil est lié à la session qui l'a enregistré ; révoquer la
// session ou se déconnecter supprime son token.
func TestDevicesFollowSessions(t *testing.T) {
	c, _, email := verifiedUser(t)

	// Email non vérifié : enregistrement refusé ; token invalide : 422.
	u := newClient(t)
	s := registerUser(t, u, uniqueEmail("unverified"))
	u.bearer = s.AccessToken
	expect(t, u.do(http.MethodPost, "/api/v1/me/devices", map[string]any{"token": newExpoToken(), "platform": "ios", "installId": uuid.NewString()}),
		http.StatusForbidden, auth.CodeEmailNotVerified)
	expect(t, c.do(http.MethodPost, "/api/v1/me/devices", map[string]any{"token": "fcm:abc", "platform": "ios", "installId": uuid.NewString()}),
		http.StatusUnprocessableEntity, "request.validation_failed")

	// Réenregistrement de la même installation : même ligne, nouveau token, langue par défaut fr.
	install := uuid.NewString()
	var first, again deviceResp
	r := c.do(http.MethodPost, "/api/v1/me/devices", map[string]any{"token": newExpoToken(), "platform": "ios", "installId": install})
	expect(t, r, http.StatusOK, "")
	r.decode(t, &first)
	newToken := newExpoToken()
	r = c.do(http.MethodPost, "/api/v1/me/devices", map[string]any{"token": newToken, "platform": "ios", "installId": install})
	expect(t, r, http.StatusOK, "")
	r.decode(t, &again)
	if first.ID != again.ID || again.Language != "fr" {
		t.Fatalf("re-registration: %+v then %+v", first, again)
	}
	var token, sid string
	if err := it.pool.QueryRow(t.Context(), `SELECT token, session_id FROM device_tokens WHERE id = $1`, again.ID).Scan(&token, &sid); err != nil {
		t.Fatal(err)
	}
	if token != newToken || sid != currentSessionID(t, c) {
		t.Fatalf("device token/session not updated (session %s)", sid)
	}

	// Une deuxième session (autre appareil) : la révoquer depuis la première supprime son token.
	c2 := newClient(t)
	c2.bearer = login(t, c2, email, password).AccessToken
	_, d2 := registerDevice(t, c2, "en")
	expect(t, c.do(http.MethodDelete, "/api/v1/me/sessions/"+currentSessionID(t, c2), nil), http.StatusNoContent, "")
	if deviceExists(t, d2.ID) {
		t.Error("device of a revoked session still registered")
	}

	// Déconnexion : le token de la session courante disparaît.
	expect(t, c.do(http.MethodPost, "/api/v1/auth/logout", nil), http.StatusNoContent, "")
	if deviceExists(t, again.ID) {
		t.Error("device still registered after logout")
	}

	// Changement de mot de passe : les autres sessions et leurs appareils sont révoqués.
	c3 := newClient(t)
	c3.bearer = login(t, c3, email, password).AccessToken
	c4 := newClient(t)
	c4.bearer = login(t, c4, email, password).AccessToken
	_, d4 := registerDevice(t, c4, "fr")
	expect(t, c3.do(http.MethodPost, "/api/v1/me/change-password", map[string]string{"currentPassword": password, "newPassword": "Porto-Novo-Lagune-2026"}),
		http.StatusNoContent, "")
	if deviceExists(t, d4.ID) {
		t.Error("device kept after a password change revoked its session")
	}

	// Désenregistrement explicite ; l'appareil d'un autre compte reste introuvable (404).
	_, d3 := registerDevice(t, c3, "fr")
	other, _, _ := verifiedUser(t)
	expect(t, other.do(http.MethodDelete, "/api/v1/me/devices/"+d3.ID, nil), http.StatusNotFound, "resource.not_found")
	expect(t, c3.do(http.MethodDelete, "/api/v1/me/devices/"+d3.ID, nil), http.StatusNoContent, "")
	if deviceExists(t, d3.ID) {
		t.Error("device still registered after DELETE")
	}
}

// pushTarget crée directement un utilisateur actif, sa session et son appareil.
func pushTarget(t *testing.T, alive bool) (uuid.UUID, string, uuid.UUID) {
	t.Helper()
	ctx := t.Context()
	var uid uuid.UUID
	if err := it.pool.QueryRow(ctx, `INSERT INTO users (email, password_hash, first_name, last_name, privacy_policy_version, privacy_accepted_at, email_verified_at)
		VALUES ($1, '!', 'Push', 'Target', '1.0', now(), now()) RETURNING id`, uniqueEmail("push")).Scan(&uid); err != nil {
		t.Fatal(err)
	}
	sid := uuid.NewString()
	if alive {
		sess, _, err := it.svc.Sessions.Create(ctx, auth.Session{UserID: uid, Role: "user", Client: auth.ClientMobile}, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		sid = sess.ID
	}
	token := newExpoToken()
	var id uuid.UUID
	if err := it.pool.QueryRow(ctx, `INSERT INTO device_tokens (user_id, token, platform, session_id, install_id, language)
		VALUES ($1, $2, 'android', $3, $4, 'fr') RETURNING id`, uid, token, sid, uuid.New()).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return uid, token, id
}

// TestPushBatchesAndReceipts : envoi par lots de 100 vers l'Expo simulé, lecture des reçus
// (DeviceNotRegistered supprime le token), appareils de sessions expirées écartés, retries
// idempotents.
func TestPushBatchesAndReceipts(t *testing.T) {
	ctx := t.Context()
	drainQueues(t)
	const users = 130
	var ids []uuid.UUID
	var tokens []string
	var deviceIDs []uuid.UUID
	err := it.svc.Store.InTx(ctx, func(q *dbgen.Queries) error {
		for range users {
			uid, token, did := pushTarget(t, true)
			id, created, err := it.svc.Notifications.Create(ctx, q, uid, notification.TypeBackInStock,
				map[string]any{"stationId": uuid.NewString(), "stationName": "Station Akpakpa", "productId": 1, "productLabel": "Gaz 12,5 kg"})
			if err != nil || !created {
				return fmt.Errorf("create notification (created %v): %w", created, err)
			}
			ids, tokens, deviceIDs = append(ids, id), append(tokens, token), append(deviceIDs, did)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	// Un appareil dont la session a expiré (jamais révoquée) : écarté et supprimé.
	expiredUID, expiredToken, expiredDevice := pushTarget(t, false)
	err = it.svc.Store.InTx(ctx, func(q *dbgen.Queries) error {
		id, _, err := it.svc.Notifications.Create(ctx, q, expiredUID, notification.TypeBackInStock, map[string]any{"stationName": "X", "productLabel": "Y"})
		ids = append(ids, id)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	it.expo.markDead(tokens[7]) // désinstallé : le reçu dira DeviceNotRegistered

	it.expo.mu.Lock()
	batchesBefore := len(it.expo.batches)
	it.expo.mu.Unlock()
	if err := it.svc.Notifications.Deliver(ctx, ids); err != nil {
		t.Fatal(err)
	}
	it.expo.mu.Lock()
	batches := slices.Clone(it.expo.batches[batchesBefore:])
	authSeen := it.expo.auth["Bearer it-expo-token"]
	it.expo.mu.Unlock()
	if !slices.Equal(batches, []int{100, 30}) || !authSeen {
		t.Fatalf("batches = %v (auth header seen %v), want [100 30]", batches, authSeen)
	}
	msg := it.expo.to(tokens[0])
	if len(msg) != 1 || msg[0].Title != "De retour en stock" || msg[0].Data["type"] != "back_in_stock" || msg[0].Data["notificationId"] != ids[0].String() {
		t.Fatalf("message = %+v", msg)
	}
	if len(it.expo.to(expiredToken)) != 0 || deviceExists(t, expiredDevice.String()) {
		t.Error("device of an expired session received a push or was kept")
	}

	// Retry de la même tâche : rien n'est renvoyé (notifications marquées remises).
	if err := it.svc.Notifications.Deliver(ctx, ids); err != nil {
		t.Fatal(err)
	}
	if n := len(it.expo.to(tokens[0])); n != 1 {
		t.Fatalf("retry re-sent the push (%d messages)", n)
	}
	var pushed int
	if err := it.pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE id = ANY($1) AND pushed_at IS NOT NULL`, ids).Scan(&pushed); err != nil || pushed != len(ids) {
		t.Fatalf("pushed notifications = %d (%v), want %d", pushed, err, len(ids))
	}

	// Reçus lus après le délai (300 ms en test) : le token mort est supprimé, les autres restent.
	waitUntil(t, "dead device removal", func() bool { return !deviceExists(t, deviceIDs[7].String()) })
	if !deviceExists(t, deviceIDs[8].String()) {
		t.Error("a delivered device was removed")
	}
	it.expo.mu.Lock()
	receipts := len(it.expo.receipts)
	it.expo.mu.Unlock()
	if receipts == 0 {
		t.Error("receipts never read")
	}
}

// TestFakePusherLogsNoPersonalData : le Pusher factice (dev, EXPO_ACCESS_TOKEN vide) ne
// journalise que le type et le nombre de messages.
func TestFakePusherLogsNoPersonalData(t *testing.T) {
	var buf logBuffer
	fake := push.NewFake(newTestLogger(&buf))
	token := newExpoToken()
	tickets, err := fake.Send(context.Background(), []push.Message{{
		To: token, Title: "De retour en stock", Body: "Gaz 12,5 kg est de nouveau disponible à « Station Afi ».",
		Data: map[string]any{"type": "back_in_stock", "stationName": "Station Afi"},
	}})
	if err != nil || len(tickets) != 1 || tickets[0].ID == "" {
		t.Fatalf("tickets = %+v, %v", tickets, err)
	}
	out := buf.String()
	if !strings.Contains(out, "back_in_stock") {
		t.Errorf("fake push log lacks the notification type: %s", out)
	}
	for _, secret := range []string{token, "Station Afi", "Gaz 12,5 kg", "disponible"} {
		if strings.Contains(out, secret) {
			t.Errorf("fake push log contains %q", secret)
		}
	}
}

// TestInboxAndSettings : boîte de réception paginée, lecture, préférences par type (opt-out).
func TestInboxAndSettings(t *testing.T) {
	ctx := t.Context()
	c, s, _ := verifiedUser(t)
	uid := uuid.MustParse(s.User.ID)
	var ids []uuid.UUID
	err := it.svc.Store.InTx(ctx, func(q *dbgen.Queries) error {
		for i := range 3 {
			id, _, err := it.svc.Notifications.Create(ctx, q, uid, notification.TypeBackInStock, map[string]any{"stationName": fmt.Sprint("S", i), "productLabel": "Essence"})
			if err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var page inboxResp
	c.do(http.MethodGet, "/api/v1/me/notifications?limit=2", nil).decode(t, &page)
	if len(page.Items) != 2 || page.Items[0].ID != ids[2].String() || page.NextCursor == nil || page.UnreadCount != 3 {
		t.Fatalf("page 1 = %+v", page)
	}
	c.do(http.MethodGet, "/api/v1/me/notifications?limit=2&cursor="+*page.NextCursor, nil).decode(t, &page)
	if len(page.Items) != 1 || page.Items[0].ID != ids[0].String() || page.NextCursor != nil {
		t.Fatalf("page 2 = %+v", page)
	}
	var unread struct {
		UnreadCount int `json:"unreadCount"`
	}
	r := c.do(http.MethodPost, "/api/v1/me/notifications/read", map[string]any{"ids": []string{ids[0].String()}})
	expect(t, r, http.StatusOK, "")
	r.decode(t, &unread)
	if unread.UnreadCount != 2 {
		t.Fatalf("unread after one read = %d", unread.UnreadCount)
	}
	expect(t, c.do(http.MethodPost, "/api/v1/me/notifications/read", map[string]any{}), http.StatusUnprocessableEntity, "request.validation_failed")
	c.do(http.MethodPost, "/api/v1/me/notifications/read", map[string]any{"all": true}).decode(t, &unread)
	if unread.UnreadCount != 0 {
		t.Fatalf("unread after all = %d", unread.UnreadCount)
	}

	// Préférences : un utilisateur ne voit que back_in_stock ; l'opt-out bloque la création.
	var settings struct {
		Items []struct {
			Type    string `json:"type"`
			Enabled bool   `json:"enabled"`
		} `json:"items"`
	}
	c.do(http.MethodGet, "/api/v1/me/notification-settings", nil).decode(t, &settings)
	if len(settings.Items) != 1 || settings.Items[0].Type != "back_in_stock" || !settings.Items[0].Enabled {
		t.Fatalf("settings = %+v", settings)
	}
	expect(t, c.do(http.MethodPut, "/api/v1/me/notification-settings", map[string]any{"settings": []map[string]any{{"type": "stock_reminder", "enabled": false}}}),
		http.StatusUnprocessableEntity, "request.validation_failed")
	r = c.do(http.MethodPut, "/api/v1/me/notification-settings", map[string]any{"settings": []map[string]any{{"type": "back_in_stock", "enabled": false}}})
	expect(t, r, http.StatusOK, "")
	r.decode(t, &settings)
	if settings.Items[0].Enabled {
		t.Fatal("opt-out not saved")
	}
	err = it.svc.Store.InTx(ctx, func(q *dbgen.Queries) error {
		_, created, err := it.svc.Notifications.Create(ctx, q, uid, notification.TypeBackInStock, map[string]any{})
		if created {
			t.Error("notification created despite the opt-out")
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

// TestEmailsGoThroughAsynqWithRetry : les emails partent par la tâche email:send, chiffrés dans
// Redis, et un échec SMTP temporaire est réessayé avec backoff.
func TestEmailsGoThroughAsynqWithRetry(t *testing.T) {
	ctx := t.Context()
	email := uniqueEmail("flaky")
	it.mailer.failNext(email, 2)
	c := newClient(t)
	registerUser(t, c, email)

	// Pendant les retries, aucune clé asynq ne contient l'adresse en clair.
	keys, err := it.rdb.Keys(ctx, "asynq:*").Result()
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range keys {
		if typ, _ := it.rdb.Type(ctx, k).Result(); typ == "hash" {
			vals, _ := it.rdb.HGetAll(ctx, k).Result()
			for _, v := range vals {
				if strings.Contains(v, email) {
					t.Fatalf("asynq key %s contains the recipient in clear", k)
				}
			}
		}
	}

	if _, err := it.mailpit.WaitFor(ctx, email, "Confirmez votre adresse"); err != nil {
		t.Fatal(err)
	}
	if n := it.mailer.attemptsFor(email); n != 3 {
		t.Fatalf("SMTP attempts = %d, want 3 (2 failures then success)", n)
	}
	if strings.Contains(it.logs.String(), email) {
		t.Error("logs contain the recipient address")
	}
}
