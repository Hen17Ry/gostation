package mail

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestTemplates(t *testing.T) {
	loc, _ := time.LoadLocation("Africa/Porto-Novo")
	r, err := NewRenderer(loc)
	if err != nil {
		t.Fatal(err)
	}
	m, err := r.VerifyEmail("afi@example.bj", "Afi <script>", "048213", 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if m.Subject != "Confirmez votre adresse email – GoStation" || m.To != "afi@example.bj" {
		t.Errorf("message = %+v", m)
	}
	for _, want := range []string{"048213", "15 minutes", "Bonjour Afi &lt;script&gt;", "#C2410C", `lang="fr"`} {
		if !strings.Contains(m.HTML, want) {
			t.Errorf("HTML missing %q", want)
		}
	}
	if strings.Contains(m.HTML, "<script>") {
		t.Error("HTML must escape user data")
	}
	// La version texte n'est jamais interprétée : le prénom y figure tel quel.
	if !strings.Contains(m.Text, "048213") || !strings.Contains(m.Text, "Bonjour Afi <script>,") {
		t.Errorf("text version = %q", m.Text)
	}

	reset, err := r.ResetPassword("afi@example.bj", "Afi", "112233", 15*time.Minute)
	if err != nil || !strings.Contains(reset.HTML, "112233") || !strings.Contains(reset.Subject, "Réinitialisation") {
		t.Errorf("reset = %+v, %v", reset.Subject, err)
	}
	changed, err := r.PasswordChanged("afi@example.bj", "Afi", time.Date(2026, 10, 10, 13, 5, 0, 0, time.UTC))
	if err != nil || !strings.Contains(changed.Text, "10/10/2026 à 14h05") {
		t.Errorf("password changed text = %q, %v (want Benin local time)", changed.Text, err)
	}
}

func TestStationStatusEmails(t *testing.T) {
	loc, _ := time.LoadLocation("Africa/Porto-Novo")
	r, err := NewRenderer(loc)
	if err != nil {
		t.Fatal(err)
	}
	rejected, err := r.StationStatus("k@example.bj", "Kofi", "Station <Akpakpa>", StationRejected, "Justificatif illisible")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Refusée", "Justificatif illisible", "Station &lt;Akpakpa&gt;", "#B91C1C"} {
		if !strings.Contains(rejected.HTML, want) {
			t.Errorf("rejection HTML missing %q", want)
		}
	}
	if !strings.Contains(rejected.Text, "[Refusée]") || !strings.Contains(rejected.Text, "Motif : Justificatif illisible") {
		t.Errorf("rejection text = %q", rejected.Text)
	}
	approved, _ := r.StationStatus("k@example.bj", "Kofi", "Station Akpakpa", StationApproved, "ignored")
	if strings.Contains(approved.HTML, "Motif") || strings.Contains(approved.HTML, "ignored") || !strings.Contains(approved.HTML, "Approuvée") {
		t.Error("an approval must show the Approuvée label and never a reason")
	}
	if _, err := r.StationStatus("k@example.bj", "Kofi", "S", StationStatusChange("bogus"), ""); err == nil {
		t.Error("unknown change accepted")
	}
}

func TestBuildMIME(t *testing.T) {
	from, _ := mail.ParseAddress("GoStation <no-reply@gostation.bj>")
	to, _ := mail.ParseAddress("afi@example.bj")
	raw, err := build(from, to, Message{Subject: "Réinitialisation – GoStation", Text: "Code : 123456", HTML: "<p>Code : <b>123456</b></p>"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	msg, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	subject, _ := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	if subject != "Réinitialisation – GoStation" || !strings.Contains(msg.Header.Get("Message-Id"), "@gostation.bj>") {
		t.Errorf("headers = %v (subject %q)", msg.Header, subject)
	}
	mediaType, params, _ := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if mediaType != "multipart/alternative" {
		t.Fatalf("content type = %s", mediaType)
	}
	mr := multipart.NewReader(msg.Body, params["boundary"])
	var types []string
	for {
		p, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(p) // décodage quoted-printable automatique
		types = append(types, p.Header.Get("Content-Type"))
		if !strings.Contains(string(body), "123456") {
			t.Errorf("part %s body = %q", p.Header.Get("Content-Type"), body)
		}
	}
	if strings.Join(types, ",") != "text/plain; charset=utf-8,text/html; charset=utf-8" {
		t.Errorf("parts = %v", types)
	}

	// Injection d'en-tête : le sujet est encodé (RFC 2047), CR/LF ne peuvent pas créer d'en-tête.
	raw, err = build(from, to, Message{Subject: "evil\r\nBcc: victim@example.bj", Text: "x", HTML: "x"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	injected, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	if bcc := injected.Header.Get("Bcc"); bcc != "" {
		t.Errorf("header injection possible: Bcc=%q", bcc)
	}
}

type recordingMailer struct {
	mu   sync.Mutex
	sent []Message
}

func (r *recordingMailer) Send(_ context.Context, m Message) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sent = append(r.sent, m)
	return nil
}

func TestAsyncDeliversAndDrainsOnClose(t *testing.T) {
	rec := &recordingMailer{}
	a := NewAsync(rec, slog.New(slog.DiscardHandler), 2, 10)
	for range 5 {
		if err := a.Send(t.Context(), Message{To: "x@example.bj", Subject: "s"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.Close(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(rec.sent) != 5 {
		t.Fatalf("sent %d messages, want 5", len(rec.sent))
	}
}

func TestNewSMTPValidation(t *testing.T) {
	if _, err := NewSMTP(SMTPConfig{From: "not an address", TLSMode: TLSNone}); err == nil {
		t.Error("invalid From accepted")
	}
	if _, err := NewSMTP(SMTPConfig{From: "a@b.bj", TLSMode: "ssl"}); err == nil {
		t.Error("invalid TLS mode accepted")
	}
}
