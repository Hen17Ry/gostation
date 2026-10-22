package mail

import (
	"context"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
	"testing"
	"time"

	"gostation/backend/internal/platform/crypto"
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

// Régression (score mail-tester du staging) : SpamAssassin pénalise le texte invisible
// (FONT_INVIS_MSGID, -2,5) ; l'ancien pré-en-tête masqué et le liseré en font-size 0 en étaient.
func TestEmailsHaveNoHiddenText(t *testing.T) {
	loc, _ := time.LoadLocation("Africa/Porto-Novo")
	r, err := NewRenderer(loc)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 10, 13, 5, 0, 0, time.UTC)
	render := map[string]func() (Message, error){
		"verify":  func() (Message, error) { return r.VerifyEmail("afi@example.bj", "Afi", "048213", 15*time.Minute) },
		"reset":   func() (Message, error) { return r.ResetPassword("afi@example.bj", "Afi", "112233", 15*time.Minute) },
		"changed": func() (Message, error) { return r.PasswordChanged("afi@example.bj", "Afi", now) },
		"approved": func() (Message, error) {
			return r.StationStatus("afi@example.bj", "Afi", "Station Akpakpa", StationApproved, "")
		},
		"corrected": func() (Message, error) {
			return r.StationCorrected("afi@example.bj", "Afi", "Station Akpakpa", []string{"name"}, "Coquille")
		},
		"received": func() (Message, error) {
			return r.DataRequestReceived("afi@example.bj", "Afi", "access", "DR-1", now, "")
		},
		"code": func() (Message, error) {
			return r.DataRequestCode("afi@example.bj", "Afi", "access", "DR-1", "123456", time.Hour, "")
		},
		"export":     func() (Message, error) { return r.DataExportReady("afi@example.bj", "Afi", now) },
		"deleted":    func() (Message, error) { return r.AccountDeleted("afi@example.bj", "Afi", DeletedBySelf) },
		"inactivity": func() (Message, error) { return r.InactivityWarning("afi@example.bj", "Afi", 700*24*time.Hour, now) },
	}
	hidden := []string{"display:none", "opacity:0", "color:transparent", "font-size:0", "max-height:0", "visibility:hidden"}
	for name, fn := range render {
		m, err := fn()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		html := strings.ReplaceAll(m.HTML, " ", "")
		for _, h := range hidden {
			if strings.Contains(html, h) {
				t.Errorf("%s: hidden text style %q in HTML", name, h)
			}
		}
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
	moveRejected, _ := r.StationStatus("k@example.bj", "Kofi", "Station Akpakpa", StationMoveRejected, "Adresse incohérente")
	if !strings.Contains(moveRejected.Text, "Motif : Adresse incohérente") || !strings.Contains(moveRejected.Subject, "Déplacement refusé") ||
		!strings.Contains(moveRejected.Text, "ancienne position reste active") {
		t.Errorf("move rejection = %q / %q", moveRejected.Subject, moveRejected.Text)
	}
	for change, want := range map[StationStatusChange]string{
		StationMoveApproved: "Position validée", StationResubmitted: "En attente de validation", StationIdentityChanged: "En attente de validation",
		StationRemindersPaused: "Stocks à mettre à jour",
	} {
		m, err := r.StationStatus("k@example.bj", "Kofi", "Station Akpakpa", change, "ignored")
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(m.Text, "["+want+"]") || strings.Contains(m.HTML, "ignored") || strings.Contains(m.Text, "Motif") {
			t.Errorf("%s: text %q", change, m.Text)
		}
	}
	ack, _ := r.StationStatus("k@example.bj", "Kofi", "Station Akpakpa", StationResubmitted, "")
	if !strings.Contains(ack.HTML, "#C2410C") || !strings.Contains(ack.HTML, "&#8226;") {
		t.Error("an acknowledgement uses the orange information badge, with a non-color marker")
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

type recordingEnqueuer struct {
	payloads [][]byte
}

func (r *recordingEnqueuer) EnqueueEmail(_ context.Context, sealed []byte) error {
	r.payloads = append(r.payloads, sealed)
	return nil
}

// TestQueueSealsMessages : la file ne contient jamais l'adresse ni le code en clair, et le
// worker retrouve le message intact ; une charge altérée est refusée.
func TestQueueSealsMessages(t *testing.T) {
	sealer, err := crypto.NewSealer(make([]byte, crypto.KeySize))
	if err != nil {
		t.Fatal(err)
	}
	rec := &recordingEnqueuer{}
	q := NewQueue(rec, sealer)
	m := Message{To: "afi@example.bj", Subject: "Code", Text: "Votre code : 482913", HTML: "<b>482913</b>"}
	if err := q.Send(t.Context(), m); err != nil {
		t.Fatal(err)
	}
	if len(rec.payloads) != 1 {
		t.Fatalf("enqueued %d payloads, want 1", len(rec.payloads))
	}
	raw := string(rec.payloads[0])
	for _, secret := range []string{"afi@example.bj", "482913"} {
		if strings.Contains(raw, secret) {
			t.Errorf("queued payload contains %q in clear", secret)
		}
	}
	got, err := q.Decode(rec.payloads[0])
	if err != nil || got != m {
		t.Fatalf("Decode = %+v, %v; want %+v", got, err, m)
	}
	tampered := append([]byte(nil), rec.payloads[0]...)
	tampered[len(tampered)-1] ^= 1
	if _, err := q.Decode(tampered); err == nil {
		t.Error("tampered payload decoded")
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
