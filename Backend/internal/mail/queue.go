package mail

import (
	"context"
	"encoding/json"
	"fmt"
)

// Enqueuer met en file une tâche d'envoi d'email (*jobs.Client).
type Enqueuer interface {
	EnqueueEmail(ctx context.Context, sealed []byte) error
}

// Sealer chiffre et déchiffre la charge utile (*crypto.Sealer).
type Sealer interface {
	Seal(plaintext, aad []byte) []byte
	Open(sealed, aad []byte) ([]byte, error)
}

// queueAAD lie le texte chiffré à son usage.
var queueAAD = []byte("gostation:email-queue:v1")

// Queue est le Mailer de l'API : il met l'email en file (tâche asynq email:send, avec retry et
// backoff) au lieu de l'envoyer. Le message est chiffré : adresse et codes à usage unique ne
// sont jamais en clair dans Redis. Le temps de réponse ne dépend pas du serveur SMTP
// (anti-énumération). Le worker déchiffre avec Decode puis envoie par SMTP.
type Queue struct {
	q      Enqueuer
	sealer Sealer
}

// NewQueue construit la file.
func NewQueue(q Enqueuer, sealer Sealer) *Queue { return &Queue{q: q, sealer: sealer} }

// Send met le message en file.
func (q *Queue) Send(ctx context.Context, m Message) error {
	raw, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("mail: encode queued message: %w", err)
	}
	if err := q.q.EnqueueEmail(ctx, q.sealer.Seal(raw, queueAAD)); err != nil {
		return fmt.Errorf("mail: enqueue: %w", err)
	}
	return nil
}

// Decode déchiffre une charge utile produite par Send.
func (q *Queue) Decode(sealed []byte) (Message, error) {
	raw, err := q.sealer.Open(sealed, queueAAD)
	if err != nil {
		return Message{}, fmt.Errorf("mail: open queued message: %w", err)
	}
	var m Message
	if err := json.Unmarshal(raw, &m); err != nil {
		return Message{}, fmt.Errorf("mail: decode queued message: %w", err)
	}
	return m, nil
}
