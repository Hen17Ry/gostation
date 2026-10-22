package mail

import (
	"context"
	"testing"
)

type recordingMailer struct{ to []string }

func (r *recordingMailer) Send(_ context.Context, m Message) error {
	r.to = append(r.to, m.To)
	return nil
}

// Les adresses des domaines de test partent vers le serveur de capture, toutes les autres vers
// le fournisseur (sous-domaines compris, casse ignorée).
func TestRouterSendsTestDomainsToSink(t *testing.T) {
	primary, sink := &recordingMailer{}, &recordingMailer{}
	r := NewRouter(primary, sink, []string{"example.bj", "test"})
	for _, to := range []string{
		"gerant.ab12.1@example.bj", "Ama <mobile-e2e-1@Example.TEST>", "x@sub.example.bj",
		"awa@gmail.com", "x@notexample.bj", "x@example.bj.evil.com", "not an address",
	} {
		if err := r.Send(context.Background(), Message{To: to}); err != nil {
			t.Fatal(err)
		}
	}
	want := []string{"gerant.ab12.1@example.bj", "Ama <mobile-e2e-1@Example.TEST>", "x@sub.example.bj"}
	if len(sink.to) != len(want) {
		t.Fatalf("sink got %v, want %v", sink.to, want)
	}
	for i := range want {
		if sink.to[i] != want[i] {
			t.Errorf("sink[%d] = %q, want %q", i, sink.to[i], want[i])
		}
	}
	if len(primary.to) != 4 {
		t.Errorf("primary got %v", primary.to)
	}
}
