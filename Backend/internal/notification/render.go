package notification

import (
	"fmt"
	"maps"
	"strconv"

	"github.com/google/uuid"

	"gostation/backend/internal/push"
	"gostation/backend/internal/store/dbgen"
)

// Catégorie Expo des rappels : l'app la déclare avec deux actions, « Mettre à jour » (ouvre
// l'app) et « Rien n'a changé » (appelle la confirmation des stocks sans ouvrir l'app).
const (
	CategoryStockReminder = "stock_reminder"
	ActionUpdate          = "update"
	ActionConfirm         = "confirm"
	// ConfirmPath est la route appelée par l'action « Rien n'a changé », avec If-Match.
	ConfirmPath = "/api/v1/manager/station/stocks/confirm"
)

// Canaux Android, créés par l'app au démarrage (src/features/notifications/channels.ts) :
// l'utilisateur règle le son et l'importance de chacun dans les paramètres du système.
const (
	ChannelStockReminders = "stock-reminders" // rappels de stock (importance haute)
	ChannelStockAlerts    = "stock-alerts"    // alertes « de retour en stock »
	ChannelReports        = "reports"         // signalements de la station
	ChannelAccount        = "account"         // décisions de l'admin sur la station
)

// Durées de vie des push côté Expo/FCM/APNs : au-delà, le message n'a plus de sens.
const (
	ttlReminder    = 4 * 3600
	ttlReported    = 24 * 3600
	ttlBackInStock = 6 * 3600
	ttlDecision    = 3 * 24 * 3600
)

// buildMessage compose le push d'un appareil : texte dans la langue de l'appareil, données pour
// l'app (type, identifiant, paramètres, actions).
//
// Android : message de données (ni titre, ni texte, ni canal ; `channelId` dans les données) que la
// tâche de l'app, réveillée même app tuée, présente avec un texte composé d'après les données (D75).
// Un push avec titre y serait affiché par le système dès que l'app n'est pas au premier plan : sans
// la catégorie du rappel ni ses actions, et, si Android a tué le processus en gardant la tâche, un
// toucher perdrait le lien vers l'écran du type. iOS affiche les catégories des push distants et
// transmet les réponses : notification ordinaire.
func buildMessage(token, lang string, platform dbgen.DevicePlatform, t Type, id uuid.UUID, data map[string]any) push.Message {
	title, body := texts(lang, t, data)
	payload := maps.Clone(data)
	if payload == nil {
		payload = map[string]any{}
	}
	payload["type"] = string(t)
	payload["notificationId"] = id.String()
	m := push.Message{To: token, Title: title, Body: body, Data: payload, Sound: "default", Priority: "high"}
	switch t {
	case TypeStockReminder:
		m.CategoryID, m.ChannelID, m.TTL = CategoryStockReminder, ChannelStockReminders, ttlReminder
		etag, _ := data["etag"].(string)
		payload["actions"] = []map[string]any{
			{"id": ActionUpdate, "opensApp": true},
			{"id": ActionConfirm, "opensApp": false, "method": "POST", "path": ConfirmPath, "ifMatch": etag},
		}
	case TypeStationReported:
		m.ChannelID, m.TTL = ChannelReports, ttlReported
	case TypeBackInStock:
		m.ChannelID, m.TTL, m.Priority = ChannelStockAlerts, ttlBackInStock, "normal"
	case TypeStationDecision:
		m.ChannelID, m.TTL = ChannelAccount, ttlDecision
	}
	if platform == dbgen.DevicePlatformAndroid {
		payload["channelId"] = m.ChannelID
		m.Title, m.Body, m.Sound, m.ChannelID, m.CategoryID = "", "", "", "", ""
		m.ContentAvailable = true
	}
	return m
}

func str(d map[string]any, key string) string {
	v, _ := d[key].(string)
	return v
}

func num(d map[string]any, key string) (int, bool) {
	switch v := d[key].(type) {
	case float64:
		return int(v), true
	case int:
		return v, true
	default:
		return 0, false
	}
}

// texts renvoie le titre et le corps d'un push (fr par défaut, en prêt).
func texts(lang string, t Type, d map[string]any) (title, body string) {
	en := lang == LangEN
	station, product := str(d, "stationName"), str(d, "productLabel")
	switch t {
	case TypeStockReminder:
		h, known := num(d, "hoursSinceUpdate")
		if en {
			title = "Are your stocks up to date?"
			body = station + ": enter your stocks to appear in search."
			if known {
				body = station + ": last update " + strconv.Itoa(h) + " h ago. Update or confirm in one tap."
			}
			return title, body
		}
		title = "Vos stocks sont-ils à jour ?"
		body = "« " + station + " » : renseignez vos stocks pour apparaître dans la recherche."
		if known {
			body = "« " + station + " » : dernière mise à jour il y a " + strconv.Itoa(h) + " h. Mettez à jour ou confirmez en un geste."
		}
		return title, body
	case TypeStationReported:
		n, _ := num(d, "reporters")
		return reportedTexts(en, str(d, "level"), str(d, "reason"), station, product, n)
	case TypeBackInStock:
		if en {
			return "Back in stock", product + " is available again at " + station + "."
		}
		return "De retour en stock", product + " est de nouveau disponible à « " + station + " »."
	case TypeStationDecision:
		if title, body, ok := decisionTexts(en, str(d, "decision"), station); ok {
			return title, body
		}
	}
	if en {
		return "GoStation", "You have a new notification."
	}
	return "GoStation", "Vous avez une nouvelle notification."
}

// decisionTexts : décision de l'admin. Le motif n'est jamais dans le push (il est dans l'email et
// dans l'app, écran de statut).
func decisionTexts(en bool, decision, station string) (title, body string, ok bool) {
	type pair struct{ title, body string }
	var p pair
	if en {
		p, ok = map[string]pair{
			DecisionApproved:     {"Station approved", station + " is approved: enter your stocks to appear in search."},
			DecisionRejected:     {"Application declined", station + ": your application was declined. See why and correct it in the app."},
			DecisionSuspended:    {"Station suspended", station + " is suspended and hidden from search. See why in the app."},
			DecisionReinstated:   {"Station reinstated", station + " is active again."},
			DecisionMoveApproved: {"New location approved", "The new location of " + station + " is approved."},
			DecisionMoveRejected: {"New location declined", "The move of " + station + " was declined: the previous location stays active."},
		}[decision]
		return p.title, p.body, ok
	}
	q := "« " + station + " »"
	p, ok = map[string]pair{
		DecisionApproved:     {"Station validée", q + " est validée : renseignez vos stocks pour apparaître dans la recherche."},
		DecisionRejected:     {"Dossier refusé", q + " : votre dossier a été refusé. Consultez le motif et corrigez-le dans l'app."},
		DecisionSuspended:    {"Station suspendue", q + " est suspendue et n'apparaît plus dans la recherche. Consultez le motif dans l'app."},
		DecisionReinstated:   {"Station réactivée", q + " est de nouveau active."},
		DecisionMoveApproved: {"Déplacement validé", "La nouvelle position de " + q + " est validée."},
		DecisionMoveRejected: {"Déplacement refusé", "Le déplacement de " + q + " a été refusé : l'ancienne position reste active."},
	}[decision]
	return p.title, p.body, ok
}

func reportedTexts(en bool, level, reason, station, product string, n int) (title, body string) {
	if level == LevelExcluded {
		if en {
			what := station + " is hidden from search"
			if product != "" {
				what = station + " is hidden from search for " + product
			}
			return "Station hidden from search", fmt.Sprintf("%s after %d reports. Update or confirm your stocks to reappear.", what, n)
		}
		what := "« " + station + " » n'apparaît plus dans la recherche"
		if product != "" {
			what = "« " + station + " » n'apparaît plus pour " + product
		}
		return "Station masquée dans la recherche", fmt.Sprintf("%s après %d signalements. Mettez à jour ou confirmez vos stocks pour réapparaître.", what, n)
	}
	if en {
		switch reason {
		case "out_of_stock":
			body = fmt.Sprintf("%d users report %s out of stock at %s. Update or confirm your stocks.", n, product, station)
		case "station_closed":
			body = fmt.Sprintf("%d users report %s as closed. Confirm your stocks if you are open.", n, station)
		case "wrong_location":
			body = fmt.Sprintf("%d users report a wrong location for %s. Check the pin.", n, station)
		default:
			body = fmt.Sprintf("%d users report a problem at %s.", n, station)
		}
		return "Station reported", body
	}
	switch reason {
	case "out_of_stock":
		// Produit en fin de phrase : « rupture de Essence » demanderait une élision.
		body = fmt.Sprintf("%d utilisateurs signalent une rupture à « %s » : %s. Mettez à jour ou confirmez vos stocks.", n, station, product)
	case "station_closed":
		body = fmt.Sprintf("%d utilisateurs signalent « %s » comme fermée. Confirmez vos stocks si vous êtes ouvert.", n, station)
	case "wrong_location":
		body = fmt.Sprintf("%d utilisateurs signalent une position incorrecte pour « %s ». Vérifiez l'épingle.", n, station)
	default:
		body = fmt.Sprintf("%d utilisateurs signalent un problème à « %s ».", n, station)
	}
	return "Station signalée", body
}
