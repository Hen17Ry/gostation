// Package mail envoie les emails transactionnels : interface Mailer, implémentation SMTP
// générique, envoi asynchrone et rendu des templates (HTML + texte, en français).
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Message est un email prêt à envoyer.
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

// Mailer envoie un message.
type Mailer interface {
	Send(ctx context.Context, m Message) error
}

// Modes TLS de SMTP_TLS.
const (
	TLSNone     = "none"
	TLSStartTLS = "starttls"
	TLSImplicit = "tls"
)

// SMTPConfig configure l'implémentation SMTP.
type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string // « GoStation <no-reply@example.com> »
	TLSMode  string
	Timeout  time.Duration
}

// SMTP envoie les messages à un serveur SMTP (Mailpit en dev, fournisseur en prod).
type SMTP struct {
	cfg  SMTPConfig
	from *mail.Address
}

// NewSMTP valide la configuration.
func NewSMTP(cfg SMTPConfig) (*SMTP, error) {
	from, err := mail.ParseAddress(cfg.From)
	if err != nil {
		return nil, fmt.Errorf("mail: invalid SMTP_FROM: %w", err)
	}
	switch cfg.TLSMode {
	case TLSNone, TLSStartTLS, TLSImplicit:
	default:
		return nil, fmt.Errorf("mail: invalid TLS mode %q", cfg.TLSMode)
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 10 * time.Second
	}
	return &SMTP{cfg: cfg, from: from}, nil
}

// Send livre le message ; chaque envoi ouvre sa propre connexion.
func (s *SMTP) Send(ctx context.Context, m Message) error {
	to, err := mail.ParseAddress(m.To)
	if err != nil {
		return fmt.Errorf("mail: invalid recipient: %w", err)
	}
	raw, err := build(s.from, to, m, time.Now())
	if err != nil {
		return err
	}

	addr := net.JoinHostPort(s.cfg.Host, strconv.Itoa(s.cfg.Port))
	dialer := &net.Dialer{Timeout: s.cfg.Timeout}
	tlsCfg := &tls.Config{ServerName: s.cfg.Host, MinVersion: tls.VersionTLS12}
	var conn net.Conn
	if s.cfg.TLSMode == TLSImplicit {
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: tlsCfg}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("mail: dial %s: %w", addr, err)
	}
	_ = conn.SetDeadline(time.Now().Add(s.cfg.Timeout))

	c, err := smtp.NewClient(conn, s.cfg.Host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("mail: smtp handshake: %w", err)
	}
	defer func() { _ = c.Close() }()

	if s.cfg.TLSMode == TLSStartTLS {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return errors.New("mail: server does not support STARTTLS")
		}
		if err := c.StartTLS(tlsCfg); err != nil {
			return fmt.Errorf("mail: starttls: %w", err)
		}
	}
	if s.cfg.Username != "" {
		if err := c.Auth(smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)); err != nil {
			return fmt.Errorf("mail: auth: %w", err)
		}
	}
	if err := c.Mail(s.from.Address); err != nil {
		return fmt.Errorf("mail: MAIL FROM: %w", err)
	}
	if err := c.Rcpt(to.Address); err != nil {
		return fmt.Errorf("mail: RCPT TO: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("mail: DATA: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		_ = w.Close()
		return fmt.Errorf("mail: write body: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("mail: end data: %w", err)
	}
	return c.Quit()
}

// build compose un message MIME multipart/alternative (texte puis HTML), en quoted-printable.
func build(from, to *mail.Address, m Message, now time.Time) ([]byte, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	domain := from.Address[strings.LastIndex(from.Address, "@")+1:]
	id := make([]byte, 16)
	_, _ = rand.Read(id)

	headers := []struct{ k, v string }{
		{"From", from.String()},
		{"To", to.String()},
		{"Subject", mime.QEncoding.Encode("utf-8", m.Subject)},
		{"Date", now.Format(time.RFC1123Z)},
		{"Message-ID", "<" + hex.EncodeToString(id) + "@" + domain + ">"},
		{"MIME-Version", "1.0"},
		{"Content-Type", `multipart/alternative; boundary="` + mw.Boundary() + `"`},
	}
	for _, h := range headers {
		if strings.ContainsAny(h.v, "\r\n") {
			return nil, fmt.Errorf("mail: invalid %s header", h.k)
		}
		fmt.Fprintf(&buf, "%s: %s\r\n", h.k, h.v)
	}
	buf.WriteString("\r\n")

	for _, part := range []struct{ ctype, body string }{
		{"text/plain; charset=utf-8", m.Text},
		{"text/html; charset=utf-8", m.HTML},
	} {
		pw, err := mw.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {part.ctype},
			"Content-Transfer-Encoding": {"quoted-printable"},
		})
		if err != nil {
			return nil, fmt.Errorf("mail: create part: %w", err)
		}
		qp := quotedprintable.NewWriter(pw)
		if _, err := qp.Write([]byte(part.body)); err != nil {
			return nil, fmt.Errorf("mail: encode part: %w", err)
		}
		if err := qp.Close(); err != nil {
			return nil, fmt.Errorf("mail: encode part: %w", err)
		}
	}
	if err := mw.Close(); err != nil {
		return nil, fmt.Errorf("mail: close multipart: %w", err)
	}
	return buf.Bytes(), nil
}

// Async envoie en arrière-plan : la réponse HTTP n'attend pas le serveur SMTP, et son temps
// ne trahit donc pas l'existence d'un compte (anti-énumération). File bornée ; en cas de
// saturation, le message est abandonné et journalisé. Remplacé par asynq plus tard.
type Async struct {
	next  Mailer
	queue chan Message
	log   *slog.Logger
	wg    sync.WaitGroup
	once  sync.Once
}

// NewAsync démarre workers goroutines d'envoi.
func NewAsync(next Mailer, log *slog.Logger, workers, queueSize int) *Async {
	a := &Async{next: next, queue: make(chan Message, queueSize), log: log}
	for range workers {
		a.wg.Go(a.work)
	}
	return a
}

func (a *Async) work() {
	for m := range a.queue {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		if err := a.next.Send(ctx, m); err != nil {
			a.log.ErrorContext(ctx, "send email", slog.String("subject", m.Subject), slog.Any("err", err))
		}
		cancel()
	}
}

// Send met le message en file sans bloquer.
func (a *Async) Send(ctx context.Context, m Message) error {
	select {
	case a.queue <- m:
		return nil
	default:
		a.log.ErrorContext(ctx, "email queue full, message dropped", slog.String("subject", m.Subject))
		return errors.New("mail: queue full")
	}
}

// Close arrête la file et attend la fin des envois en cours, dans la limite de ctx.
func (a *Async) Close(ctx context.Context) error {
	a.once.Do(func() { close(a.queue) })
	done := make(chan struct{})
	go func() { a.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("mail: pending emails not sent: %w", ctx.Err())
	}
}
