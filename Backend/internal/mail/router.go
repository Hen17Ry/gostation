package mail

import (
	"context"
	"net/mail"
	"strings"
)

// Router envoie les emails des domaines de test (SMTP_SINK_DOMAINS : example.bj, test…) à un
// serveur de capture, le Mailpit du staging, et tous les autres au fournisseur. Les comptes des
// parcours E2E ne provoquent ainsi aucun rebond chez le fournisseur (sa réputation d'envoi en
// dépend), et les tests lisent leurs codes dans Mailpit. Hors production seulement (config).
type Router struct {
	primary, sink Mailer
	domains       []string
}

// NewRouter construit le Router. domains : noms en minuscules ; « test » couvre aussi
// « example.test ».
func NewRouter(primary, sink Mailer, domains []string) *Router {
	return &Router{primary: primary, sink: sink, domains: domains}
}

// Send choisit le serveur d'après le domaine du destinataire.
func (r *Router) Send(ctx context.Context, m Message) error {
	if r.toSink(m.To) {
		return r.sink.Send(ctx, m)
	}
	return r.primary.Send(ctx, m)
}

func (r *Router) toSink(to string) bool {
	addr, err := mail.ParseAddress(to)
	if err != nil {
		return false // le fournisseur refusera l'adresse avec une erreur explicite
	}
	domain := strings.ToLower(addr.Address[strings.LastIndexByte(addr.Address, '@')+1:])
	for _, d := range r.domains {
		if domain == d || strings.HasSuffix(domain, "."+d) {
			return true
		}
	}
	return false
}
