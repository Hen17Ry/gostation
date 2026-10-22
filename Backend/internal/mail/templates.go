package mail

import (
	"bytes"
	"embed"
	"fmt"
	htmltemplate "html/template"
	"strings"
	texttemplate "text/template"
	"time"
)

//go:embed templates/*.tmpl
var templateFS embed.FS

// Noms des emails ; chacun a un template HTML et un template texte.
const (
	tmplVerifyEmail     = "verify_email"
	tmplResetPassword   = "reset_password"
	tmplPasswordChanged = "password_changed"
	tmplStationStatus   = "station_status"
	tmplDataRequestCode = "data_request_code"
)

// Renderer produit les messages à partir des templates embarqués.
type Renderer struct {
	html map[string]*htmltemplate.Template
	text map[string]*texttemplate.Template
	loc  *time.Location
	now  func() time.Time
}

// NewRenderer charge les templates. loc est le fuseau d'affichage des dates (Africa/Porto-Novo).
func NewRenderer(loc *time.Location) (*Renderer, error) {
	r := &Renderer{
		html: map[string]*htmltemplate.Template{},
		text: map[string]*texttemplate.Template{},
		loc:  loc,
		now:  time.Now,
	}
	for _, name := range []string{tmplVerifyEmail, tmplResetPassword, tmplPasswordChanged, tmplStationStatus, tmplDataRequestCode} {
		h, err := htmltemplate.ParseFS(templateFS, "templates/layout.html.tmpl", "templates/code.html.tmpl", "templates/"+name+".html.tmpl")
		if err != nil {
			return nil, fmt.Errorf("mail: parse %s html: %w", name, err)
		}
		t, err := texttemplate.ParseFS(templateFS, "templates/layout.txt.tmpl", "templates/"+name+".txt.tmpl")
		if err != nil {
			return nil, fmt.Errorf("mail: parse %s text: %w", name, err)
		}
		r.html[name], r.text[name] = h, t
	}
	return r, nil
}

type templateData struct {
	Title          string
	FirstName      string
	Code           string
	ExpiresMinutes int
	When           string
	Year           int
	// Changement de statut d'une station.
	Badge  string
	Tone   string // success | danger
	Lead   string
	Reason string
	Next   string
	// ReasonLabel remplace « Motif » au-dessus de Reason (« Réponse » d'une demande traitée).
	ReasonLabel string
	// ExpiresDays : validité d'un code de confirmation de demande (jours).
	ExpiresDays int
}

func (r *Renderer) render(name, to, subject string, d templateData) (Message, error) {
	d.Year = r.now().In(r.loc).Year()
	var h, t bytes.Buffer
	if err := r.html[name].ExecuteTemplate(&h, "layout", d); err != nil {
		return Message{}, fmt.Errorf("mail: render %s html: %w", name, err)
	}
	if err := r.text[name].ExecuteTemplate(&t, "layout", d); err != nil {
		return Message{}, fmt.Errorf("mail: render %s text: %w", name, err)
	}
	return Message{To: to, Subject: subject, HTML: h.String(), Text: t.String()}, nil
}

// VerifyEmail : code de vérification de l'adresse email.
func (r *Renderer) VerifyEmail(to, firstName, code string, ttl time.Duration) (Message, error) {
	return r.render(tmplVerifyEmail, to, "Confirmez votre adresse email – GoStation", templateData{
		Title:          "Confirmez votre adresse email",
		FirstName:      firstName,
		Code:           code,
		ExpiresMinutes: int(ttl.Minutes()),
	})
}

// ResetPassword : code de réinitialisation du mot de passe.
func (r *Renderer) ResetPassword(to, firstName, code string, ttl time.Duration) (Message, error) {
	return r.render(tmplResetPassword, to, "Réinitialisation de votre mot de passe – GoStation", templateData{
		Title:          "Réinitialisation du mot de passe",
		FirstName:      firstName,
		Code:           code,
		ExpiresMinutes: int(ttl.Minutes()),
	})
}

// PasswordChanged : notification de sécurité après un changement de mot de passe.
func (r *Renderer) PasswordChanged(to, firstName string, at time.Time) (Message, error) {
	return r.render(tmplPasswordChanged, to, "Votre mot de passe a été modifié – GoStation", templateData{
		Title:     "Mot de passe modifié",
		FirstName: firstName,
		When:      at.In(r.loc).Format("02/01/2006 à 15h04"),
	})
}

// StationStatusChange décrit un changement de statut (décision de l'admin ou accusé de réception).
type StationStatusChange string

// Changements de statut notifiés au gérant.
const (
	StationApproved   StationStatusChange = "approved"
	StationRejected   StationStatusChange = "rejected"
	StationSuspended  StationStatusChange = "suspended"
	StationReinstated StationStatusChange = "reinstated"
	// Décision de l'admin sur une demande de déplacement.
	StationMoveApproved StationStatusChange = "move_approved"
	StationMoveRejected StationStatusChange = "move_rejected"
	// Accusés de réception : la station repasse en pending à l'initiative du gérant.
	StationResubmitted     StationStatusChange = "resubmitted"
	StationIdentityChanged StationStatusChange = "identity_changed"
	// Rappels de stock ignorés de suite : arrêt pour la journée (étape 6).
	StationRemindersPaused StationStatusChange = "reminders_paused"
)

// StationCorrected prévient le gérant que l'admin a corrigé les informations de sa station
// (fields : libellés français des champs modifiés), avec le motif.
func (r *Renderer) StationCorrected(to, firstName, stationName string, fields []string, reason string) (Message, error) {
	d := templateData{FirstName: firstName, Reason: reason, Title: "Informations corrigées", Badge: "Informations corrigées", Tone: "info"}
	d.Lead = "L'équipe GoStation a corrigé les informations de « " + stationName + " » : " + strings.Join(fields, ", ") + "."
	d.Next = "Vérifiez votre fiche dans l'application. Si une information est inexacte, répondez à l'équipe GoStation."
	return r.render(tmplStationStatus, to, "Informations de votre station corrigées – GoStation", d)
}

// StationStatus notifie le gérant d'une décision de l'admin sur sa station. Le statut est porté
// par un libellé, jamais par la seule couleur.
func (r *Renderer) StationStatus(to, firstName, stationName string, change StationStatusChange, reason string) (Message, error) {
	d := templateData{FirstName: firstName, Reason: reason}
	var subject string
	switch change {
	case StationApproved:
		d.Reason = "" // une approbation n'a pas de motif
		subject, d.Title, d.Badge, d.Tone = "Votre station est validée – GoStation", "Station validée", "Approuvée", "success"
		d.Lead = "Bonne nouvelle : « " + stationName + " » est validée. Épinglez sa position, renseignez vos horaires et vos stocks pour apparaître dans la recherche."
		d.Next = "Ouvrez l'application GoStation pour terminer la configuration de votre station."
	case StationRejected:
		subject, d.Title, d.Badge, d.Tone = "Votre demande doit être corrigée – GoStation", "Demande à corriger", "Refusée", "danger"
		d.Lead = "Votre demande pour « " + stationName + " » n'a pas pu être validée en l'état."
		d.Next = "Corrigez vos informations ou renvoyez un justificatif depuis l'application : votre demande sera de nouveau examinée."
	case StationSuspended:
		subject, d.Title, d.Badge, d.Tone = "Votre station est suspendue – GoStation", "Station suspendue", "Suspendue", "danger"
		d.Lead = "« " + stationName + " » est suspendue : elle n'apparaît plus dans la recherche."
		d.Next = "Pour toute question, répondez à l'équipe GoStation depuis l'application."
	case StationReinstated:
		subject, d.Title, d.Badge, d.Tone = "Votre station est réactivée – GoStation", "Station réactivée", "Réactivée", "success"
		d.Lead = "« " + stationName + " » est de nouveau active et visible dans la recherche."
		d.Next = "Pensez à vérifier vos stocks et vos horaires dans l'application."
	case StationMoveApproved:
		d.Reason = ""
		subject, d.Title, d.Badge, d.Tone = "Nouvelle position validée – GoStation", "Position validée", "Position validée", "success"
		d.Lead = "La nouvelle position de « " + stationName + " » est validée : c'est elle que la recherche utilise désormais."
		d.Next = "Vérifiez l'épingle sur la carte de l'application si besoin."
	case StationMoveRejected:
		subject, d.Title, d.Badge, d.Tone = "Déplacement refusé – GoStation", "Déplacement refusé", "Déplacement refusé", "danger"
		d.Lead = "La demande de déplacement de « " + stationName + " » n'a pas été validée. L'ancienne position reste active."
		d.Next = "Vous pouvez épingler à nouveau la station depuis l'application."
	case StationResubmitted:
		d.Reason = ""
		subject, d.Title, d.Badge, d.Tone = "Demande reçue – GoStation", "Demande reçue", "En attente de validation", "info"
		d.Lead = "Nous avons bien reçu votre nouveau justificatif pour « " + stationName + " ». Votre demande est de nouveau en cours d'examen."
		d.Next = "Vous recevrez un email dès qu'elle sera traitée."
	case StationIdentityChanged:
		d.Reason = ""
		subject, d.Title, d.Badge, d.Tone = "Modification en cours de vérification – GoStation", "Modification à vérifier", "En attente de validation", "info"
		d.Lead = "Vous avez modifié l'IFU ou le RCCM de « " + stationName + " ». La station est retirée de la recherche le temps que l'équipe GoStation vérifie ces informations."
		d.Next = "Vous recevrez un email dès que la vérification sera terminée."
	case StationRemindersPaused:
		d.Reason = ""
		subject, d.Title, d.Badge, d.Tone = "Rappels suspendus pour aujourd'hui – GoStation", "Rappels suspendus", "Stocks à mettre à jour", "info"
		d.Lead = "Les stocks de « " + stationName + " » n'ont pas été mis à jour malgré plusieurs rappels. Nous suspendons les rappels jusqu'à demain et l'équipe GoStation a été prévenue."
		d.Next = "Mettez à jour vos stocks, ou confirmez-les d'un geste depuis l'application : au-delà de 24 h sans mise à jour, votre station disparaît de la recherche."
	default:
		return Message{}, fmt.Errorf("mail: unknown station status change %q", change)
	}
	return r.render(tmplStationStatus, to, subject, d)
}
