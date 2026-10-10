package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"gostation/backend/internal/ratelimit"
)

// Purpose distingue les usages des codes à 6 chiffres.
type Purpose string

// Usages des codes.
const (
	PurposeVerifyEmail   Purpose = "verify_email"
	PurposeResetPassword Purpose = "reset_password"
)

// Règles des codes (décision D5) : 15 min, 5 essais, renvoi 1/min et 5/h.
const (
	OTPTTL            = 15 * time.Minute
	OTPMaxAttempts    = 5
	OTPResendCooldown = time.Minute
	OTPResendPerHour  = 5
)

// Erreurs des codes.
var (
	ErrInvalidCode     = errors.New("auth: invalid or expired code")
	ErrResendTooSoon   = errors.New("auth: code resent too recently")
	ErrResendExhausted = errors.New("auth: too many codes requested")
)

// Limiter est implémenté par *ratelimit.Limiter (fenêtre glissante Redis).
type Limiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (ratelimit.Result, error)
}

// OTPStore gère les codes dans Redis : otp:{purpose}:{uid} → HASH {hash, attempts}, TTL 15 min.
// Le code est stocké sous forme de HMAC-SHA256 (clé dérivée d'APP_SECRET) : une fuite de Redis
// ne révèle pas les codes en clair.
type OTPStore struct {
	rdb    goredis.UniversalClient
	key    []byte
	limit  Limiter
	verify *goredis.Script
}

// NewOTPStore construit le store. key est la clé HMAC (32 octets).
func NewOTPStore(rdb goredis.UniversalClient, key []byte, limit Limiter) *OTPStore {
	return &OTPStore{rdb: rdb, key: key, limit: limit, verify: goredis.NewScript(verifyOTPScript)}
}

func otpKey(p Purpose, uid uuid.UUID) string { return "otp:" + string(p) + ":" + uid.String() }

func (s *OTPStore) hash(p Purpose, uid uuid.UUID, code string) string {
	m := hmac.New(sha256.New, s.key)
	m.Write([]byte(string(p) + "|" + uid.String() + "|" + code))
	return hex.EncodeToString(m.Sum(nil))
}

// Issue génère un nouveau code (remplace le précédent) en respectant les limites de renvoi.
func (s *OTPStore) Issue(ctx context.Context, p Purpose, uid uuid.UUID) (string, error) {
	cooldown := "otp:cooldown:" + string(p) + ":" + uid.String()
	ok, err := s.rdb.SetNX(ctx, cooldown, "1", OTPResendCooldown).Result()
	if err != nil {
		return "", fmt.Errorf("auth: otp cooldown: %w", err)
	}
	if !ok {
		return "", ErrResendTooSoon
	}
	res, err := s.limit.Allow(ctx, "otp-issue:"+string(p)+":"+uid.String(), OTPResendPerHour, time.Hour)
	if err != nil {
		return "", fmt.Errorf("auth: otp hourly limit: %w", err)
	}
	if !res.Allowed {
		return "", ErrResendExhausted
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("auth: generate code: %w", err)
	}
	code := fmt.Sprintf("%06d", n.Int64())
	key := otpKey(p, uid)
	_, err = s.rdb.TxPipelined(ctx, func(pipe goredis.Pipeliner) error {
		pipe.Del(ctx, key)
		pipe.HSet(ctx, key, "hash", s.hash(p, uid, code), "attempts", 0)
		pipe.PExpire(ctx, key, OTPTTL)
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("auth: store code: %w", err)
	}
	return code, nil
}

// Vérification atomique. KEYS[1] = otp:{purpose}:{uid}. ARGV[1] = hash proposé, ARGV[2] = max.
// Retourne 1 si le code est bon (il est alors consommé), 0 sinon ; au 5e échec le code est détruit.
const verifyOTPScript = `
local h = redis.call('HGET', KEYS[1], 'hash')
if not h then return 0 end
if h == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
end
return 0
`

// Verify consomme le code s'il est valide.
func (s *OTPStore) Verify(ctx context.Context, p Purpose, uid uuid.UUID, code string) error {
	if len(code) != 6 {
		return ErrInvalidCode
	}
	ok, err := s.verify.Run(ctx, s.rdb, []string{otpKey(p, uid)}, s.hash(p, uid, code), OTPMaxAttempts).Int()
	if err != nil {
		return fmt.Errorf("auth: verify code: %w", err)
	}
	if ok != 1 {
		return ErrInvalidCode
	}
	return nil
}
