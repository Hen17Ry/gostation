// Package errtrack envoie les erreurs serveur (réponses 5xx, panics, tâches en échec définitif) à
// GlitchTip, auto-hébergé et compatible Sentry (D90). Désactivé si SENTRY_DSN est vide.
//
// Aucune donnée personnelle ne part : Scrub (BeforeSend) retire la requête entière (URL et query
// string, en-têtes, cookies, corps, IP), l'utilisateur et le fil d'Ariane, puis masque dans tous
// les textes restants (message, exceptions, tags) les emails, les jetons (JWT, refresh,
// défi 2FA, push Expo, Bearer), les coordonnées, les adresses IP et les numéros de téléphone.
package errtrack

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"regexp"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
)

// Config regroupe les réglages (config.ErrorTracking).
type Config struct {
	DSN         string
	Environment string
	Release     string
	// Service distingue l'API du worker (tag « service »).
	Service string
	// Transport remplace l'envoi HTTP (tests).
	Transport sentry.Transport
}

// Tracker envoie les erreurs. Un Tracker nil ou sans DSN ne fait rien.
type Tracker struct {
	hub *sentry.Hub
}

// New construit le Tracker ; sans DSN, il est inactif.
func New(cfg Config) (*Tracker, error) {
	if cfg.DSN == "" {
		return &Tracker{}, nil
	}
	client, err := sentry.NewClient(sentry.ClientOptions{
		Dsn:         cfg.DSN,
		Environment: cfg.Environment,
		Release:     cfg.Release,
		ServerName:  cfg.Service,
		Transport:   cfg.Transport,
		// Aucune instrumentation automatique (pas de middleware HTTP du SDK) : la requête et
		// l'utilisateur ne sont jamais renseignés, et Scrub les retire de toute façon.
		AttachStacktrace: true,
		MaxBreadcrumbs:   -1,
		BeforeSend: func(e *sentry.Event, _ *sentry.EventHint) *sentry.Event {
			return Scrub(e)
		},
		BeforeBreadcrumb: func(*sentry.Breadcrumb, *sentry.BreadcrumbHint) *sentry.Breadcrumb { return nil },
	})
	if err != nil {
		return nil, fmt.Errorf("errtrack: %w", err)
	}
	scope := sentry.NewScope()
	scope.SetTag("service", cfg.Service)
	return &Tracker{hub: sentry.NewHub(client, scope)}, nil
}

// Enabled indique si les erreurs partent vraiment.
func (t *Tracker) Enabled() bool { return t != nil && t.hub != nil }

// Report envoie une erreur avec des tags (route, code, tâche…). Les valeurs passent aussi par Scrub.
func (t *Tracker) Report(_ context.Context, err error, tags map[string]string) {
	if !t.Enabled() || err == nil {
		return
	}
	t.hub.WithScope(func(s *sentry.Scope) {
		s.SetTags(tags)
		t.hub.CaptureException(err)
	})
}

// Flush attend l'envoi des erreurs en file (arrêt du processus).
func (t *Tracker) Flush(timeout time.Duration) {
	if t.Enabled() {
		t.hub.Flush(timeout)
	}
}

// SendTest envoie un message de test et attend son départ (commande errtrack-test de l'API et du
// worker) : vérifie le DSN, le chemin réseau et le projet GlitchTip après un déploiement.
func (t *Tracker) SendTest(service string, timeout time.Duration) (string, error) {
	if !t.Enabled() {
		return "", errors.New("errtrack: SENTRY_DSN is empty")
	}
	id := t.hub.CaptureMessage("GlitchTip test event (" + service + ")")
	if id == nil {
		return "", errors.New("errtrack: test event dropped")
	}
	if !t.hub.Flush(timeout) {
		return "", fmt.Errorf("errtrack: test event not sent within %s", timeout)
	}
	return string(*id), nil
}

// Scrub retire d'un événement tout ce qui pourrait identifier une personne ou la situer.
func Scrub(e *sentry.Event) *sentry.Event {
	if e == nil {
		return nil
	}
	e.Request = nil
	e.User = sentry.User{}
	e.Breadcrumbs = nil
	e.Message = scrubText(e.Message)
	for i := range e.Exception {
		e.Exception[i].Value = scrubText(e.Exception[i].Value)
		if st := e.Exception[i].Stacktrace; st != nil {
			scrubFrames(st.Frames)
		}
	}
	for i := range e.Threads {
		if st := e.Threads[i].Stacktrace; st != nil {
			scrubFrames(st.Frames)
		}
	}
	for k, v := range e.Tags {
		e.Tags[k] = scrubText(v)
	}
	// Contextes : seuls ceux du SDK (système, runtime, trace) sont gardés.
	for k := range e.Contexts {
		switch k {
		case "os", "runtime", "trace", "device":
		default:
			delete(e.Contexts, k)
		}
	}
	return e
}

// Les variables locales ne sont pas collectées par sentry-go ; le contexte de source l'est si le
// code est présent (jamais dans l'image distroless) et passe quand même par le masque.
func scrubFrames(frames []sentry.Frame) {
	for i := range frames {
		frames[i].Vars = nil
		frames[i].ContextLine = scrubText(frames[i].ContextLine)
		frames[i].PreContext = nil
		frames[i].PostContext = nil
	}
}

var (
	reEmail = regexp.MustCompile(`(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}`)
	reToken = regexp.MustCompile(`eyJ[\w-]+\.[\w-]+\.[\w-]*|\bgs[rm]_[\w-]+|ExponentPushToken\[[^\]]*\]|(?i:\bbearer\s+\S+)`)
	// lat=6.37, "lng": 2.42, latitude: …
	reCoordParam = regexp.MustCompile(`(?i)\b(lat|lng|lon|latitude|longitude)(["']?\s*[:=]\s*["']?)-?\d+(?:\.\d+)?`)
	// Nombre décimal d'au moins 4 décimales : une coordonnée nue (6.3703, 2.4253).
	reDecimal = regexp.MustCompile(`-?\b\d{1,3}\.\d{4,}\b`)
	reIPv4    = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`)
	// Candidats IPv6 (au moins deux « : »), confirmés par netip : une heure (12:30:45) n'en est pas.
	reIPv6  = regexp.MustCompile(`(?i)[0-9a-f]*:[0-9a-f:.]*:[0-9a-f:.%]*`)
	rePhone = regexp.MustCompile(`\+\d{8,15}\b`)
)

func scrubText(s string) string {
	if s == "" {
		return s
	}
	s = reEmail.ReplaceAllString(s, "[email]")
	s = reToken.ReplaceAllString(s, "[token]")
	s = reCoordParam.ReplaceAllString(s, "${1}${2}***")
	s = reIPv4.ReplaceAllString(s, "[ip]")
	s = reIPv6.ReplaceAllStringFunc(s, func(m string) string {
		if _, err := netip.ParseAddr(strings.Trim(m, ".:")); err == nil {
			return "[ip]"
		}
		return m
	})
	s = reDecimal.ReplaceAllString(s, "[coord]")
	return rePhone.ReplaceAllString(s, "[phone]")
}
