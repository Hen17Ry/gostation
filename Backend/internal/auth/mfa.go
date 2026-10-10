package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"
)

// Défi 2FA admin : après le mot de passe, POST /auth/admin/login renvoie un mfaToken
// (5 min, 5 essais). Pendant la mise en place, le secret TOTP en attente est conservé dans
// le défi (chiffré) et n'est écrit en base qu'après un premier code valide.
//
//	auth:mfa:{sha256(token)}   HASH uid, pending (secret chiffré, base64), attempts
//	auth:totp:last:{uid}       STR  dernier pas TOTP accepté (anti-rejeu)
const (
	MFATokenTTL       = 5 * time.Minute
	MFAMaxAttempts    = 5
	mfaPrefix         = "auth:mfa:"
	totpLastPrefix    = "auth:totp:last:"
	mfaTokenTag       = "gsm_"
	totpReplayWindowS = 3 * 30
)

// ErrInvalidMFAToken signale un défi absent, expiré ou épuisé.
var ErrInvalidMFAToken = errors.New("auth: invalid or expired mfa token")

// MFAChallenge est un défi en cours.
type MFAChallenge struct {
	UserID        uuid.UUID
	PendingSecret []byte // chiffré ; nil si la 2FA est déjà configurée
}

// MFAStore gère les défis 2FA dans Redis.
type MFAStore struct {
	rdb goredis.UniversalClient
}

// NewMFAStore construit le store.
func NewMFAStore(rdb goredis.UniversalClient) *MFAStore { return &MFAStore{rdb: rdb} }

// Start crée un défi et renvoie son token opaque.
func (s *MFAStore) Start(ctx context.Context, uid uuid.UUID, pendingSecretSealed []byte) (string, error) {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	token := mfaTokenTag + base64.RawURLEncoding.EncodeToString(b)
	key := mfaPrefix + hashToken(token)
	fields := map[string]any{"uid": uid.String(), "attempts": 0}
	if pendingSecretSealed != nil {
		fields["pending"] = base64.StdEncoding.EncodeToString(pendingSecretSealed)
	}
	_, err := s.rdb.TxPipelined(ctx, func(p goredis.Pipeliner) error {
		p.HSet(ctx, key, fields)
		p.PExpire(ctx, key, MFATokenTTL)
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("auth: start mfa challenge: %w", err)
	}
	return token, nil
}

// Get lit le défi sans le consommer.
func (s *MFAStore) Get(ctx context.Context, token string) (MFAChallenge, error) {
	m, err := s.rdb.HGetAll(ctx, mfaPrefix+hashToken(token)).Result()
	if err != nil {
		return MFAChallenge{}, fmt.Errorf("auth: get mfa challenge: %w", err)
	}
	if len(m) == 0 {
		return MFAChallenge{}, ErrInvalidMFAToken
	}
	uid, err := uuid.Parse(m["uid"])
	if err != nil {
		return MFAChallenge{}, ErrInvalidMFAToken
	}
	c := MFAChallenge{UserID: uid}
	if p := m["pending"]; p != "" {
		if c.PendingSecret, err = base64.StdEncoding.DecodeString(p); err != nil {
			return MFAChallenge{}, ErrInvalidMFAToken
		}
	}
	return c, nil
}

// Fail compte un échec ; au 5e, le défi est détruit.
func (s *MFAStore) Fail(ctx context.Context, token string) error {
	key := mfaPrefix + hashToken(token)
	n, err := s.rdb.HIncrBy(ctx, key, "attempts", 1).Result()
	if err != nil {
		return fmt.Errorf("auth: mfa attempt: %w", err)
	}
	if n >= MFAMaxAttempts {
		return s.rdb.Del(ctx, key).Err()
	}
	return nil
}

// Consume détruit le défi après succès.
func (s *MFAStore) Consume(ctx context.Context, token string) error {
	return s.rdb.Del(ctx, mfaPrefix+hashToken(token)).Err()
}

// AcceptTOTPStep refuse un pas TOTP déjà utilisé (ou plus ancien) par cet utilisateur.
func (s *MFAStore) AcceptTOTPStep(ctx context.Context, uid uuid.UUID, step int64) (bool, error) {
	key := totpLastPrefix + uid.String()
	last, err := s.rdb.Get(ctx, key).Int64()
	if err != nil && !errors.Is(err, goredis.Nil) {
		return false, fmt.Errorf("auth: totp replay check: %w", err)
	}
	if err == nil && step <= last {
		return false, nil
	}
	if err := s.rdb.Set(ctx, key, strconv.FormatInt(step, 10), totpReplayWindowS*time.Second).Err(); err != nil {
		return false, fmt.Errorf("auth: totp replay store: %w", err)
	}
	return true, nil
}

// CSRFToken dérive le jeton CSRF d'une session admin : HMAC(clé CSRF, sid). Lié à la session,
// il ne peut pas être forgé par un sous-domaine qui poserait ses propres cookies.
func CSRFToken(key []byte, sessionID string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte("csrf|" + sessionID))
	return hex.EncodeToString(m.Sum(nil))
}

// ValidCSRF compare en temps constant.
func ValidCSRF(key []byte, sessionID, presented string) bool {
	return presented != "" && hmac.Equal([]byte(CSRFToken(key, sessionID)), []byte(presented))
}
