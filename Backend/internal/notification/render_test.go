package notification

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestReminderMessage(t *testing.T) {
	id := uuid.New()
	data := map[string]any{"stationId": "s1", "stationName": "Station Akpakpa", "etag": `"v12"`, "hoursSinceUpdate": float64(5)}
	m := buildMessage("ExponentPushToken[x]", LangFR, TypeStockReminder, id, data)
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
	never := buildMessage("t", LangEN, TypeStockReminder, id, map[string]any{"stationName": "Station Akpakpa"})
	if never.Body != "Station Akpakpa: enter your stocks to appear in search." {
		t.Fatalf("english body without a previous update = %q", never.Body)
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
			"Station signalée", "3 utilisateurs signalent une rupture de Gaz 12,5 kg à « S ».",
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
