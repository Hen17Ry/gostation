package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"
)

// Structure Redis des sessions (une session = une famille de refresh tokens) :
//
//	auth:sess:{sid}           HASH  uid, role, client, ua, mfa, created_at, last_used_at, current (hash du token courant),
//	                                ttl_ms (durée glissante), deadline_ms (fin absolue, si MaxAge)
//	auth:rt:{sha256(token)}   STR   sid tant que le token est courant, puis « used:{sid} » après rotation
//	auth:user:{uid}:sess      SET   sids de l'utilisateur
//
// Seul le SHA-256 des refresh tokens est stocké. Présenter un token déjà consommé
// (« used: ») révoque toute la session : c'est le signe d'un vol de token.
const (
	sessionPrefix   = "auth:sess:"
	refreshPrefix   = "auth:rt:"
	userSessPrefix  = "auth:user:"
	usedMarker      = "used:"
	refreshTokenTag = "gsr_" // préfixe repérable par les scanners de secrets
)

// Erreurs de rotation.
var (
	ErrInvalidRefreshToken = errors.New("auth: invalid or expired refresh token")
	ErrRefreshTokenReused  = errors.New("auth: refresh token reuse detected")
)

// Clients reconnus.
const (
	ClientMobile = "mobile"
	ClientWeb    = "web"
)

// Session est la vue d'une session.
type Session struct {
	ID         string
	UserID     uuid.UUID
	Role       string
	Client     string
	UserAgent  string
	MFA        bool
	CreatedAt  time.Time
	LastUsedAt time.Time
	// MaxAge plafonne la durée de vie de la session depuis sa création (0 : glissante sans
	// plafond). Les sessions admin l'utilisent : un admin actif se reconnecte au bout de 12 h
	// (ASVS 3.3.2).
	MaxAge time.Duration
}

// RevokeHook est appelé après la révocation d'une session (suppression de son appareil push).
// Il journalise lui-même ses échecs : une révocation n'échoue jamais à cause de lui (l'envoi des
// push écarte de toute façon les appareils dont la session n'existe plus).
type RevokeHook func(ctx context.Context, sid string)

// SessionStore gère sessions et refresh tokens dans Redis.
type SessionStore struct {
	rdb      goredis.UniversalClient
	rotate   *goredis.Script
	now      func() time.Time
	onRevoke RevokeHook
}

// SessionOption configure le store.
type SessionOption func(*SessionStore)

// WithRevokeHook branche une action exécutée à chaque révocation (logout, révocation, changement
// ou réinitialisation du mot de passe, réutilisation de refresh token, suppression du compte).
func WithRevokeHook(h RevokeHook) SessionOption {
	return func(s *SessionStore) { s.onRevoke = h }
}

// NewSessionStore construit le store.
func NewSessionStore(rdb goredis.UniversalClient, opts ...SessionOption) *SessionStore {
	s := &SessionStore{rdb: rdb, rotate: goredis.NewScript(rotateScript), now: time.Now}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newRefreshToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return refreshTokenTag + base64.RawURLEncoding.EncodeToString(b)
}

func userSessKey(uid uuid.UUID) string { return userSessPrefix + uid.String() + ":sess" }

// Create ouvre une session et renvoie son premier refresh token.
func (s *SessionStore) Create(ctx context.Context, sess Session, ttl time.Duration) (Session, string, error) {
	now := s.now()
	sess.ID = uuid.NewString()
	sess.CreatedAt, sess.LastUsedAt = now, now
	if len(sess.UserAgent) > 200 {
		sess.UserAgent = sess.UserAgent[:200]
	}
	token := newRefreshToken()
	th := hashToken(token)
	ms := strconv.FormatInt(now.UnixMilli(), 10)
	fields := map[string]any{
		"uid": sess.UserID.String(), "role": sess.Role, "client": sess.Client, "ua": sess.UserAgent,
		"mfa": strconv.FormatBool(sess.MFA), "created_at": ms, "last_used_at": ms, "current": th,
		"ttl_ms": strconv.FormatInt(ttl.Milliseconds(), 10),
	}
	if sess.MaxAge > 0 {
		ttl = min(ttl, sess.MaxAge)
		fields["deadline_ms"] = strconv.FormatInt(now.Add(sess.MaxAge).UnixMilli(), 10)
	}

	_, err := s.rdb.TxPipelined(ctx, func(p goredis.Pipeliner) error {
		p.HSet(ctx, sessionPrefix+sess.ID, fields)
		p.PExpire(ctx, sessionPrefix+sess.ID, ttl)
		p.Set(ctx, refreshPrefix+th, sess.ID, ttl)
		p.SAdd(ctx, userSessKey(sess.UserID), sess.ID)
		p.PExpire(ctx, userSessKey(sess.UserID), ttl)
		return nil
	})
	if err != nil {
		return Session{}, "", fmt.Errorf("auth: create session: %w", err)
	}
	return sess, token, nil
}

// Rotation atomique. KEYS[1] = auth:rt:{ancien hash}. ARGV : nouveau hash, now (ms).
// Retourne {"ok", sid} | {"reused", sid} | {"invalid"}. La durée de vie de la session est
// glissante : chaque rotation la repousse de ttl_ms, sans dépasser deadline_ms s'il existe.
const rotateScript = `
local v = redis.call('GET', KEYS[1])
if not v then return {'invalid'} end
if string.sub(v, 1, 5) == 'used:' then return {'reused', string.sub(v, 6)} end
local skey = 'auth:sess:' .. v
local ttl = tonumber(redis.call('HGET', skey, 'ttl_ms'))
if not ttl then return {'invalid'} end
local deadline = tonumber(redis.call('HGET', skey, 'deadline_ms'))
if deadline then
  local left = deadline - tonumber(ARGV[2])
  if left <= 0 then return {'invalid'} end
  if left < ttl then ttl = left end
end
local remaining = redis.call('PTTL', KEYS[1])
if remaining < 1000 then remaining = 1000 end
redis.call('SET', KEYS[1], 'used:' .. v, 'PX', remaining)
redis.call('SET', 'auth:rt:' .. ARGV[1], v, 'PX', ttl)
redis.call('HSET', skey, 'current', ARGV[1], 'last_used_at', ARGV[2])
redis.call('PEXPIRE', skey, ttl)
local uid = redis.call('HGET', skey, 'uid')
redis.call('PEXPIRE', 'auth:user:' .. uid .. ':sess', ttl)
return {'ok', v}
`

// Rotate échange un refresh token contre un nouveau. Un token réutilisé révoque la session.
func (s *SessionStore) Rotate(ctx context.Context, token string) (Session, string, error) {
	newToken := newRefreshToken()
	res, err := s.rotate.Run(ctx, s.rdb, []string{refreshPrefix + hashToken(token)},
		hashToken(newToken), strconv.FormatInt(s.now().UnixMilli(), 10)).StringSlice()
	if err != nil {
		return Session{}, "", fmt.Errorf("auth: rotate refresh token: %w", err)
	}
	switch res[0] {
	case "ok":
		sess, err := s.Get(ctx, res[1])
		if err != nil {
			return Session{}, "", err
		}
		return sess, newToken, nil
	case "reused":
		sess, getErr := s.Get(ctx, res[1])
		if revokeErr := s.Revoke(ctx, res[1]); revokeErr != nil {
			return Session{}, "", revokeErr
		}
		if getErr != nil {
			return Session{}, "", ErrRefreshTokenReused
		}
		return sess, "", ErrRefreshTokenReused
	default:
		return Session{}, "", ErrInvalidRefreshToken
	}
}

// Lookup renvoie la session d'un refresh token courant, sans le consommer (vérification CSRF).
func (s *SessionStore) Lookup(ctx context.Context, token string) (Session, error) {
	v, err := s.rdb.Get(ctx, refreshPrefix+hashToken(token)).Result()
	if errors.Is(err, goredis.Nil) {
		return Session{}, ErrInvalidRefreshToken
	}
	if err != nil {
		return Session{}, fmt.Errorf("auth: lookup refresh token: %w", err)
	}
	if len(v) > len(usedMarker) && v[:len(usedMarker)] == usedMarker {
		v = v[len(usedMarker):] // l'appelant détectera la réutilisation à la rotation
	}
	return s.Get(ctx, v)
}

// ErrSessionNotFound signale une session expirée ou révoquée.
var ErrSessionNotFound = errors.New("auth: session not found")

// Get lit une session.
func (s *SessionStore) Get(ctx context.Context, sid string) (Session, error) {
	m, err := s.rdb.HGetAll(ctx, sessionPrefix+sid).Result()
	if err != nil {
		return Session{}, fmt.Errorf("auth: get session: %w", err)
	}
	if len(m) == 0 {
		return Session{}, ErrSessionNotFound
	}
	return parseSession(sid, m)
}

func parseSession(sid string, m map[string]string) (Session, error) {
	uid, err := uuid.Parse(m["uid"])
	if err != nil {
		return Session{}, fmt.Errorf("auth: corrupt session %s: %w", sid, err)
	}
	created, _ := strconv.ParseInt(m["created_at"], 10, 64)
	used, _ := strconv.ParseInt(m["last_used_at"], 10, 64)
	sess := Session{
		ID: sid, UserID: uid, Role: m["role"], Client: m["client"], UserAgent: m["ua"],
		MFA: m["mfa"] == "true", CreatedAt: time.UnixMilli(created), LastUsedAt: time.UnixMilli(used),
	}
	if deadline, err := strconv.ParseInt(m["deadline_ms"], 10, 64); err == nil {
		sess.MaxAge = time.UnixMilli(deadline).Sub(sess.CreatedAt)
	}
	return sess, nil
}

// Exists indique si la session est toujours active (vérifié à chaque requête authentifiée :
// une révocation prend effet immédiatement, sans attendre l'expiration de l'access token).
func (s *SessionStore) Exists(ctx context.Context, sid string) (bool, error) {
	n, err := s.rdb.Exists(ctx, sessionPrefix+sid).Result()
	if err != nil {
		return false, fmt.Errorf("auth: check session: %w", err)
	}
	return n == 1, nil
}

// Alive indique, pour chaque sid, si la session est toujours active (un seul aller-retour).
// Sert à écarter les appareils dont la session a expiré sans révocation explicite.
func (s *SessionStore) Alive(ctx context.Context, sids []string) (map[string]bool, error) {
	out := make(map[string]bool, len(sids))
	if len(sids) == 0 {
		return out, nil
	}
	cmds := make([]*goredis.IntCmd, len(sids))
	_, err := s.rdb.Pipelined(ctx, func(p goredis.Pipeliner) error {
		for i, sid := range sids {
			cmds[i] = p.Exists(ctx, sessionPrefix+sid)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("auth: check sessions: %w", err)
	}
	for i, sid := range sids {
		out[sid] = cmds[i].Val() == 1
	}
	return out, nil
}

// List renvoie les sessions actives de l'utilisateur, la plus récemment utilisée d'abord.
func (s *SessionStore) List(ctx context.Context, uid uuid.UUID) ([]Session, error) {
	sids, err := s.rdb.SMembers(ctx, userSessKey(uid)).Result()
	if err != nil {
		return nil, fmt.Errorf("auth: list sessions: %w", err)
	}
	cmds := make([]*goredis.MapStringStringCmd, len(sids))
	_, err = s.rdb.Pipelined(ctx, func(p goredis.Pipeliner) error {
		for i, sid := range sids {
			cmds[i] = p.HGetAll(ctx, sessionPrefix+sid)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("auth: list sessions: %w", err)
	}
	out := make([]Session, 0, len(sids))
	var stale []any
	for i, cmd := range cmds {
		m := cmd.Val()
		if len(m) == 0 {
			stale = append(stale, sids[i])
			continue
		}
		if sess, err := parseSession(sids[i], m); err == nil {
			out = append(out, sess)
		}
	}
	if len(stale) > 0 {
		_ = s.rdb.SRem(ctx, userSessKey(uid), stale...).Err()
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastUsedAt.After(out[j].LastUsedAt) })
	return out, nil
}

// Revoke supprime la session et son refresh token courant (idempotent).
func (s *SessionStore) Revoke(ctx context.Context, sid string) error {
	m, err := s.rdb.HMGet(ctx, sessionPrefix+sid, "uid", "current").Result()
	if err != nil {
		return fmt.Errorf("auth: revoke session: %w", err)
	}
	_, err = s.rdb.TxPipelined(ctx, func(p goredis.Pipeliner) error {
		p.Del(ctx, sessionPrefix+sid)
		if current, ok := m[1].(string); ok && current != "" {
			p.Del(ctx, refreshPrefix+current)
		}
		if uid, ok := m[0].(string); ok && uid != "" {
			p.SRem(ctx, userSessPrefix+uid+":sess", sid)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("auth: revoke session: %w", err)
	}
	if s.onRevoke != nil {
		s.onRevoke(ctx, sid)
	}
	return nil
}

// RevokeAll révoque toutes les sessions de l'utilisateur, sauf except (vide = toutes).
func (s *SessionStore) RevokeAll(ctx context.Context, uid uuid.UUID, except string) error {
	sids, err := s.rdb.SMembers(ctx, userSessKey(uid)).Result()
	if err != nil {
		return fmt.Errorf("auth: revoke sessions: %w", err)
	}
	for _, sid := range sids {
		if sid == except {
			continue
		}
		if err := s.Revoke(ctx, sid); err != nil {
			return err
		}
	}
	return nil
}
