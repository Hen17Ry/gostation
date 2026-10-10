package mail

import (
	"bytes"
	"embed"
	"fmt"
	htmltemplate "html/template"
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
	for _, name := range []string{tmplVerifyEmail, tmplResetPassword, tmplPasswordChanged, tmplStationStatus} {
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
	Preheader      string
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
		Preheader:      fmt.Sprintf("Votre code de vérification expire dans %d minutes.", int(ttl.Minutes())),
		FirstName:      firstName,
		Code:           code,
		ExpiresMinutes: int(ttl.Minutes()),
	})
}

// ResetPassword : code de réinitialisation du mot de passe.
func (r *Renderer) ResetPassword(to, firstName, code string, ttl time.Duration) (Message, error) {
	return r.render(tmplResetPassword, to, "Réinitialisation de votre mot de passe – GoStation", templateData{
		Title:          "Réinitialisation du mot de passe",
		Preheader:      fmt.Sprintf("Votre code de réinitialisation expire dans %d minutes.", int(ttl.Minutes())),
		FirstName:      firstName,
		Code:           code,
		ExpiresMinutes: int(ttl.Minutes()),
	})
}

// PasswordChanged : notification de sécurité après un changement de mot de passe.
func (r *Renderer) PasswordChanged(to, firstName string, at time.Time) (Message, error) {
	return r.render(tmplPasswordChanged, to, "Votre mot de passe a été modifié – GoStation", templateData{
		Title:     "Mot de passe modifié",
		Preheader: "Le mot de passe de votre compte GoStation vient d'être modifié.",
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
)

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
	default:
		return Message{}, fmt.Errorf("mail: unknown station status change %q", change)
	}
	d.Preheader = d.Lead
	return r.render(tmplStationStatus, to, subject, d)
}
