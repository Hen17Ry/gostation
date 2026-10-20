//go:build integration

package testutil

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// DefaultMailpitImage est aligné sur .env.example (MAILPIT_IMAGE).
const DefaultMailpitImage = "axllent/mailpit:v1.31.6"

// Mailpit est un serveur SMTP de test dont l'API permet de lire les emails reçus.
type Mailpit struct {
	SMTPHost string
	SMTPPort int
	APIURL   string
	http     *http.Client
}

// StartMailpit démarre Mailpit et renvoie le client de son API et la fonction d'arrêt. Les options
// supplémentaires personnalisent le conteneur (tests du helper lui-même).
//
// La résolution DNS inverse du client SMTP est désactivée : Mailpit la fait avant d'envoyer sa
// bannière, via les résolveurs externes du conteneur. Un DNS lent ou injoignable retardait alors la
// bannière au-delà du délai du client SMTP (10 s), et les emails des tests échouaient au hasard.
func StartMailpit(ctx context.Context, opts ...testcontainers.ContainerCustomizer) (*Mailpit, func(), error) {
	opts = append([]testcontainers.ContainerCustomizer{
		testcontainers.WithExposedPorts("1025/tcp", "8025/tcp"),
		testcontainers.WithEnv(map[string]string{"MP_SMTP_DISABLE_RDNS": "true"}),
		testcontainers.WithWaitStrategy(
			wait.ForListeningPort("1025/tcp"),
			wait.ForHTTP("/readyz").WithPort("8025/tcp"),
		),
	}, opts...)
	ctr, err := testcontainers.Run(ctx, image("MAILPIT_IMAGE", DefaultMailpitImage), opts...)
	stop := func() { _ = testcontainers.TerminateContainer(ctr) }
	if err != nil {
		stop()
		return nil, nil, fmt.Errorf("start mailpit container: %w", err)
	}
	host, err := ctr.Host(ctx)
	if err != nil {
		stop()
		return nil, nil, err
	}
	smtpPort, err := ctr.MappedPort(ctx, "1025/tcp")
	if err != nil {
		stop()
		return nil, nil, err
	}
	apiPort, err := ctr.MappedPort(ctx, "8025/tcp")
	if err != nil {
		stop()
		return nil, nil, err
	}
	return &Mailpit{
		SMTPHost: host, SMTPPort: int(smtpPort.Num()),
		APIURL: "http://" + host + ":" + apiPort.Port(),
		http:   &http.Client{Timeout: 5 * time.Second},
	}, stop, nil
}

// Email est un message reçu par Mailpit.
type Email struct {
	ID      string
	Subject string
	Text    string
	HTML    string
}

type summary struct {
	ID      string `json:"ID"`
	Subject string `json:"Subject"`
}

func (m *Mailpit) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.APIURL+path, nil)
	if err != nil {
		return err
	}
	resp, err := m.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("mailpit %s: status %d", path, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// Messages renvoie les emails reçus par to, du plus récent au plus ancien.
func (m *Mailpit) Messages(ctx context.Context, to string) ([]Email, error) {
	var res struct {
		Messages []summary `json:"messages"`
	}
	if err := m.get(ctx, "/api/v1/search?query="+url.QueryEscape(`to:"`+to+`"`), &res); err != nil {
		return nil, err
	}
	out := make([]Email, 0, len(res.Messages))
	for _, s := range res.Messages {
		var full struct {
			Subject string `json:"Subject"`
			Text    string `json:"Text"`
			HTML    string `json:"HTML"`
		}
		if err := m.get(ctx, "/api/v1/message/"+s.ID, &full); err != nil {
			return nil, err
		}
		out = append(out, Email{ID: s.ID, Subject: full.Subject, Text: full.Text, HTML: full.HTML})
	}
	return out, nil
}

// WaitFor attend un email pour to dont le sujet contient subject, et le renvoie (le plus récent).
func (m *Mailpit) WaitFor(ctx context.Context, to, subject string) (Email, error) {
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		msgs, err := m.Messages(ctx, to)
		if err != nil {
			return Email{}, err
		}
		for _, e := range msgs {
			if strings.Contains(e.Subject, subject) {
				return e, nil
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	return Email{}, fmt.Errorf("no email %q received by %s", subject, to)
}

var codePattern = regexp.MustCompile(`\b(\d{6})\b`)

// Code extrait le code à 6 chiffres d'un email.
func (e Email) Code() (string, error) {
	m := codePattern.FindStringSubmatch(e.Text)
	if m == nil {
		return "", errors.New("no 6-digit code in email")
	}
	return m[1], nil
}
