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
	for _, name := range []string{tmplVerifyEmail, tmplResetPassword, tmplPasswordChanged} {
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
