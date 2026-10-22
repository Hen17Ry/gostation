package mail

import (
	"fmt"
	"math"
	"time"
)

// Emails des droits des personnes (étape 10A). Ils ne contiennent rien d'autre que le prénom, le
// type de la demande, sa référence et ses dates : jamais les données de la personne.

// DataRequestLabel renvoie le libellé français d'un type de demande (enum data_request_type).
func DataRequestLabel(kind string) string {
	switch kind {
	case "access":
		return "accès à vos données"
	case "export":
		return "copie de vos données"
	case "rectification":
		return "rectification"
	case "deletion":
		return "suppression"
	case "opposition":
		return "opposition"
	default:
		return "autre demande"
	}
}

func contactSentence(contact string) string {
	if contact == "" {
		return ""
	}
	return " Pour toute question : " + contact + "."
}

func (r *Renderer) date(t time.Time) string { return t.In(r.loc).Format("02/01/2006") }

// DataRequestReceived accuse réception d'une demande (confirmée) et en donne l'échéance.
func (r *Renderer) DataRequestReceived(to, firstName, kind, ref string, due time.Time, contact string) (Message, error) {
	return r.render(tmplStationStatus, to, "Votre demande a bien été reçue – GoStation", templateData{
		Title:     "Demande reçue",
		FirstName: firstName, Badge: "Demande reçue", Tone: "info",
		Lead: "Nous avons bien reçu votre demande de " + DataRequestLabel(kind) + " (référence " + ref + ").",
		Next: "Nous y répondrons au plus tard le " + r.date(due) + "." + contactSentence(contact),
	})
}

// DataRequestCode demande à la personne de confirmer une demande reçue par email : le code est
// envoyé à l'adresse du compte, rien n'est traité avant qu'elle l'ait communiqué.
func (r *Renderer) DataRequestCode(to, firstName, kind, ref, code string, ttl time.Duration, contact string) (Message, error) {
	next := "Répondez avec ce code au message par lequel vous avez fait votre demande."
	if contact != "" {
		next = "Envoyez ce code, avec la référence " + ref + ", à " + contact + "."
	}
	return r.render(tmplDataRequestCode, to, "Confirmez votre demande – GoStation", templateData{
		Title:     "Confirmez votre demande",
		FirstName: firstName, Code: code, ExpiresDays: int(ttl.Hours() / 24),
		Lead: "Nous avons reçu une demande de " + DataRequestLabel(kind) + " concernant votre compte GoStation " +
			"(référence " + ref + "). Pour confirmer qu'elle vient bien de vous, communiquez ce code à l'équipe GoStation :",
		Next: next,
	})
}

// DataRequestClosed transmet la réponse à une demande, traitée ou refusée (avec son motif).
func (r *Renderer) DataRequestClosed(to, firstName, kind, ref string, accepted bool, response string) (Message, error) {
	d := templateData{
		FirstName: firstName, Reason: response,
		Next: "Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir l'Autorité de protection des " +
			"données à caractère personnel (APDP).",
	}
	subject := "Votre demande a été traitée – GoStation"
	d.Title, d.Badge, d.Tone, d.ReasonLabel = "Demande traitée", "Demande traitée", "success", "Réponse"
	d.Lead = "Votre demande de " + DataRequestLabel(kind) + " (référence " + ref + ") a été traitée."
	if !accepted {
		subject = "Réponse à votre demande – GoStation"
		d.Title, d.Badge, d.Tone, d.ReasonLabel = "Demande refusée", "Demande refusée", "danger", "Motif"
		d.Lead = "Nous ne pouvons pas donner suite à votre demande de " + DataRequestLabel(kind) + " (référence " + ref + ")."
	}
	return r.render(tmplStationStatus, to, subject, d)
}

// DataExportReady prévient que la copie des données est prête dans l'application.
func (r *Renderer) DataExportReady(to, firstName string, expires time.Time) (Message, error) {
	return r.render(tmplStationStatus, to, "La copie de vos données est prête – GoStation", templateData{
		Title:     "Copie de vos données prête",
		FirstName: firstName, Badge: "Prête", Tone: "success",
		Lead: "La copie de vos données personnelles est prête. Ouvrez GoStation, puis Compte > Mes données, pour la télécharger.",
		Next: "Elle reste disponible 24 heures (jusqu'au " + expires.In(r.loc).Format("02/01/2006 à 15h04") + "), puis elle est supprimée.",
	})
}

// Causes d'une suppression de compte.
const (
	DeletedBySelf        = "self"
	DeletedOnRequest     = "request"
	DeletedForInactivity = "inactivity"
)

// AccountDeleted confirme la suppression d'un compte (envoyé avant l'anonymisation de l'adresse).
func (r *Renderer) AccountDeleted(to, firstName, cause string) (Message, error) {
	lead := "Votre compte GoStation a été supprimé à votre demande."
	switch cause {
	case DeletedOnRequest:
		lead = "Votre compte GoStation a été supprimé, comme vous l'avez demandé à notre équipe."
	case DeletedForInactivity:
		lead = "Votre compte GoStation, inutilisé depuis longtemps, a été supprimé comme annoncé."
	}
	return r.render(tmplStationStatus, to, "Votre compte a été supprimé – GoStation", templateData{
		Title: "Compte supprimé", FirstName: firstName, Badge: "Compte supprimé", Tone: "info",
		Lead: lead,
		Next: "Vos données personnelles ont été effacées. Certaines informations sont conservées pour une durée limitée, " +
			"sans lien avec vous, comme l'explique la politique de confidentialité de l'application.",
	})
}

// InactivityWarning annonce la suppression d'un compte inactif (30 jours avant).
func (r *Renderer) InactivityWarning(to, firstName string, inactiveFor time.Duration, deletion time.Time) (Message, error) {
	months := int(math.Round(inactiveFor.Hours() / 24 / 30.44))
	return r.render(tmplStationStatus, to, "Votre compte GoStation va être supprimé – GoStation", templateData{
		Title:     "Compte inactif",
		FirstName: firstName, Badge: "Compte inactif", Tone: "danger",
		Lead: fmt.Sprintf("Votre compte GoStation n'a pas été utilisé depuis près de %d mois. Sans connexion de votre part, "+
			"il sera supprimé le %s.", months, r.date(deletion)),
		Next: "Pour le conserver, ouvrez simplement l'application GoStation et connectez-vous.",
	})
}
