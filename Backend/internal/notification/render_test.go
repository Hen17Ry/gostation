package notification

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"gostation/backend/internal/store/dbgen"
)

func TestReminderMessage(t *testing.T) {
	id := uuid.New()
	data := map[string]any{"stationId": "s1", "stationName": "Station Akpakpa", "etag": `"v12"`, "hoursSinceUpdate": float64(5)}
	m := buildMessage("ExponentPushToken[x]", LangFR, dbgen.DevicePlatformIos, TypeStockReminder, id, data)
	if m.CategoryID != CategoryStockReminder || m.TTL != ttlReminder || m.Priority != "high" {
		t.Fatalf("message = %+v", m)
	}
	if m.Title != "Vos stocks sont-ils à jour ?" || !strings.Contains(m.Body, "« Station Akpakpa » : dernière mise à jour il y a 5 h") {
		t.Fatalf("texts = %q / %q", m.Title, m.Body)
	}
	actions, _ := m.Data["actions"].([]map[string]any)
	if len(actions) != 2 || actions[0]["id"] != ActionUpdate || actions[0]["opensApp"] != true ||
		actions[1]["id"] != ActionConfirm || actions[1]["opensApp"] != false || actions[1]["ifMatch"] != `"v12"` ||
		actions[1]["path"] != ConfirmPath || actions[1]["method"] != "POST" {
		t.Fatalf("actions = %v", actions)
	}
	if m.Data["type"] != "stock_reminder" || m.Data["notificationId"] != id.String() {
		t.Fatalf("data = %v", m.Data)
	}
	if _, ok := data["actions"]; ok {
		t.Fatal("buildMessage modified the stored notification data")
	}
	never := buildMessage("t", LangEN, dbgen.DevicePlatformIos, TypeStockReminder, id, map[string]any{"stationName": "Station Akpakpa"})
	if never.Body != "Station Akpakpa: enter your stocks to appear in search." {
		t.Fatalf("english body without a previous update = %q", never.Body)
	}
}

// Android : chaque push part en message de données, canal dans les données, présenté par l'app
// (D75) ; iOS garde la notification ordinaire.
func TestAndroidMessagesAreDataOnly(t *testing.T) {
	id := uuid.New()
	data := map[string]any{"stationId": "s1", "stationName": "Station Akpakpa", "etag": `"v12"`, "hoursSinceUpdate": float64(5)}
	cases := []struct {
		typ      Type
		channel  string
		priority string
		ttl      int
	}{
		{TypeStockReminder, ChannelStockReminders, "high", ttlReminder},
		{TypeStationReported, ChannelReports, "high", ttlReported},
		{TypeBackInStock, ChannelStockAlerts, "normal", ttlBackInStock},
		{TypeStationDecision, ChannelAccount, "high", ttlDecision},
	}
	for _, c := range cases {
		m := buildMessage("t", LangFR, dbgen.DevicePlatformAndroid, c.typ, id, data)
		if m.Title != "" || m.Body != "" || m.ChannelID != "" || m.CategoryID != "" || m.Sound != "" || !m.ContentAvailable {
			t.Errorf("%s: android message must be data-only: %+v", c.typ, m)
		}
		if m.Data["channelId"] != c.channel || m.Priority != c.priority || m.TTL != c.ttl ||
			m.Data["type"] != string(c.typ) || m.Data["notificationId"] != id.String() || m.Data["stationName"] != "Station Akpakpa" {
			t.Errorf("%s: android message = %+v", c.typ, m)
		}
		ios := buildMessage("t", LangFR, dbgen.DevicePlatformIos, c.typ, id, data)
		if ios.Title == "" || ios.ChannelID != c.channel || ios.ContentAvailable || ios.Data["channelId"] != nil {
			t.Errorf("%s: ios keeps a notification message: %+v", c.typ, ios)
		}
	}
	if _, ok := data["channelId"]; ok {
		t.Fatal("buildMessage modified the stored notification data")
	}
}

func TestReportedAndBackInStockTexts(t *testing.T) {
	cases := []struct {
		lang, typ string
		data      map[string]any
		title     string
		body      string
	}{
		{
			LangFR, "station_reported",
			map[string]any{"level": LevelFlagged, "reason": "out_of_stock", "stationName": "S", "productLabel": "Gaz 12,5 kg", "reporters": float64(3)},
			"Station signalée", "3 utilisateurs signalent une rupture à « S » : Gaz 12,5 kg.",
		},
		{
			LangFR, "station_reported",
			map[string]any{"level": LevelFlagged, "reason": "station_closed", "stationName": "S", "reporters": float64(3)},
			"Station signalée", "3 utilisateurs signalent « S » comme fermée.",
		},
		{
			LangFR, "station_reported",
			map[string]any{"level": LevelExcluded, "reason": "out_of_stock", "stationName": "S", "productLabel": "Essence", "reporters": float64(5)},
			"Station masquée dans la recherche", "« S » n'apparaît plus pour Essence après 5 signalements.",
		},
		{
			LangEN, "station_reported",
			map[string]any{"level": LevelExcluded, "reason": "wrong_location", "stationName": "S", "reporters": float64(5)},
			"Station hidden from search", "S is hidden from search after 5 reports.",
		},
		{
			LangFR, "back_in_stock",
			map[string]any{"stationName": "S", "productLabel": "Gasoil"},
			"De retour en stock", "Gasoil est de nouveau disponible à « S ».",
		},
		{
			LangEN, "back_in_stock",
			map[string]any{"stationName": "S", "productLabel": "Diesel"},
			"Back in stock", "Diesel is available again at S.",
		},
	}
	for _, c := range cases {
		title, body := texts(c.lang, Type(c.typ), c.data)
		if title != c.title || !strings.HasPrefix(body, c.body) {
			t.Errorf("%s/%s: %q / %q, want %q / %q…", c.lang, c.typ, title, body, c.title, c.body)
		}
	}
}

func TestTypesForRoles(t *testing.T) {
	if got := TypesFor("user"); len(got) != 1 || got[0] != TypeBackInStock {
		t.Errorf("user types = %v", got)
	}
	if got := TypesFor("manager"); len(got) != 3 {
		t.Errorf("manager types = %v", got)
	}
	if CheckRole("admin") == nil {
		t.Error("admins have no notifications")
	}
}

func TestExpoTokenFormat(t *testing.T) {
	for token, ok := range map[string]bool{
		"ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]": true,
		"ExpoPushToken[abc-123_DEF]":                true,
		"ExponentPushToken[]":                       false,
		"fcm:token":                                 false,
		"ExponentPushToken[a b]":                    false,
	} {
		if expoToken.MatchString(token) != ok {
			t.Errorf("%q: match = %v, want %v", token, !ok, ok)
		}
	}
}

// TestChannelPerType : chaque type part sur son canal Android (créé par l'app au démarrage), seul
// le rappel porte la catégorie d'actions.
func TestChannelPerType(t *testing.T) {
	id := uuid.New()
	cases := []struct {
		typ      Type
		channel  string
		category string
		ttl      int
	}{
		{TypeStockReminder, ChannelStockReminders, CategoryStockReminder, ttlReminder},
		{TypeBackInStock, ChannelStockAlerts, "", ttlBackInStock},
		{TypeStationReported, ChannelReports, "", ttlReported},
		{TypeStationDecision, ChannelAccount, "", ttlDecision},
	}
	for _, c := range cases {
		m := buildMessage("ExponentPushToken[x]", LangFR, dbgen.DevicePlatformIos, c.typ, id, map[string]any{"stationName": "S", "decision": DecisionApproved})
		if m.ChannelID != c.channel || m.CategoryID != c.category || m.TTL != c.ttl {
			t.Errorf("%s: channel=%q category=%q ttl=%d", c.typ, m.ChannelID, m.CategoryID, m.TTL)
		}
		if m.Data["type"] != string(c.typ) {
			t.Errorf("%s: data type = %v", c.typ, m.Data["type"])
		}
	}
}

func TestDecisionTexts(t *testing.T) {
	cases := []struct {
		lang, decision, title, body string
	}{
		{LangFR, DecisionApproved, "Station validée", "« S » est validée : renseignez vos stocks pour apparaître dans la recherche."},
		{LangFR, DecisionRejected, "Dossier refusé", "« S » : votre dossier a été refusé. Consultez le motif et corrigez-le dans l'app."},
		{LangFR, DecisionSuspended, "Station suspendue", "« S » est suspendue et n'apparaît plus dans la recherche. Consultez le motif dans l'app."},
		{LangFR, DecisionReinstated, "Station réactivée", "« S » est de nouveau active."},
		{LangFR, DecisionMoveApproved, "Déplacement validé", "La nouvelle position de « S » est validée."},
		{LangFR, DecisionMoveRejected, "Déplacement refusé", "Le déplacement de « S » a été refusé : l'ancienne position reste active."},
		{LangEN, DecisionApproved, "Station approved", "S is approved: enter your stocks to appear in search."},
		{LangFR, "bogus", "GoStation", "Vous avez une nouvelle notification."},
	}
	for _, c := range cases {
		m := buildMessage("t", c.lang, dbgen.DevicePlatformIos, TypeStationDecision, uuid.New(), map[string]any{"stationName": "S", "decision": c.decision, "reason": "secret"})
		if m.Title != c.title || m.Body != c.body {
			t.Errorf("%s/%s = %q / %q", c.lang, c.decision, m.Title, m.Body)
		}
		if strings.Contains(m.Body, "secret") {
			t.Error("a decision push must never carry the admin's reason")
		}
	}
}
