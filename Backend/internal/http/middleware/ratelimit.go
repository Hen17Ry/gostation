package middleware

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"math"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/http/respond"
	"gostation/backend/internal/ratelimit"
)

// Limiter est implémenté par *ratelimit.Limiter (Redis).
type Limiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (ratelimit.Result, error)
}

// RateLimitPolicy décrit un quota : Limit requêtes par Window, par valeur de Key.
type RateLimitPolicy struct {
	Name   string
	Limit  int
	Window time.Duration
	// Key renvoie l'identifiant à limiter ; "" exempte la requête.
	Key func(*http.Request) string
	// FailClosed refuse la requête (503) si le limiteur est indisponible : pour les routes qui
	// ne peuvent pas aboutir sans Redis et dont l'abus coûte cher (inscription).
	FailClosed bool
}

// RateLimit applique la politique et pose les en-têtes RateLimit-Limit/Remaining/Reset
// (et Retry-After sur 429). Si Redis est indisponible, la requête passe (fail open) avec un
// avertissement : la disponibilité du service prime sur le quota (sauf FailClosed).
func RateLimit(l Limiter, p RateLimitPolicy, log *slog.Logger, rs *respond.Responder) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := p.Key(r)
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}
			res, err := l.Allow(r.Context(), p.Name+":"+key, p.Limit, p.Window)
			if err != nil {
				if p.FailClosed {
					log.WarnContext(r.Context(), "rate limiter unavailable, request refused",
						slog.String("policy", p.Name), slog.Any("err", err))
					rs.Error(w, r, apperr.Unavailable("Service temporarily unavailable, retry later.").Wrap(err))
					return
				}
				log.WarnContext(r.Context(), "rate limiter unavailable, request allowed",
					slog.String("policy", p.Name), slog.Any("err", err))
				next.ServeHTTP(w, r)
				return
			}
			h := w.Header()
			h.Set("RateLimit-Limit", strconv.Itoa(res.Limit))
			h.Set("RateLimit-Remaining", strconv.Itoa(res.Remaining))
			h.Set("RateLimit-Reset", ceilSeconds(res.Reset))
			if !res.Allowed {
				h.Set("Retry-After", ceilSeconds(res.RetryAfter))
				rs.Error(w, r, apperr.TooManyRequests("Too many requests, retry later."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ClientKeys calcule les clés des limiteurs : empreintes HMAC-SHA256 de l'IP, du compte ou de
// l'installation, sous la clé secrète RATE_LIMIT_KEY. Ni l'adresse IP ni l'identifiant ne sont
// écrits en clair dans Redis, et sans la clé l'empreinte d'une IP ne se retrouve pas en
// parcourant l'espace IPv4 (E1). Rotation : changer la clé remet seulement les compteurs à zéro
// (fenêtres d'une heure au plus) ; rien d'autre n'est conservé sous cette clé.
type ClientKeys struct {
	key []byte
}

// NewClientKeys construit le calculateur de clés à partir de RATE_LIMIT_KEY.
func NewClientKeys(key []byte) *ClientKeys {
	return &ClientKeys{key: key}
}

// ByClientIP identifie le client par une empreinte de son IP. En IPv6, un abonné reçoit en général
// un /64 entier et peut changer d'adresse à chaque requête : le quota porte donc sur le /64.
func (k *ClientKeys) ByClientIP(r *http.Request) string {
	ip, ok := httpctx.ClientIP(r.Context())
	if !ok {
		return ""
	}
	ip = ip.Unmap()
	if ip.Is6() {
		ip = netip.PrefixFrom(ip, 64).Masked().Addr()
	}
	return k.fingerprint(ip.AsSlice())
}

// HeaderInstallID porte l'identifiant d'installation de l'app mobile (UUID généré au premier
// lancement). Il ne sert qu'aux quotas : il n'est ni stocké en clair ni journalisé.
const HeaderInstallID = "X-Install-Id"

// ByInstallOrUser identifie le client par l'utilisateur connecté, sinon par l'en-tête
// X-Install-Id (D22). Sans en-tête valide, le quota s'applique par IP : omettre l'en-tête ne
// permet pas d'y échapper. À placer après Authenticator.Optional.
func (k *ClientKeys) ByInstallOrUser(r *http.Request) string {
	if p, ok := httpctx.PrincipalFrom(r.Context()); ok {
		return "u:" + k.fingerprint(p.UserID[:])
	}
	if id, err := uuid.Parse(strings.TrimSpace(r.Header.Get(HeaderInstallID))); err == nil && id != uuid.Nil {
		return "i:" + k.fingerprint(id[:])
	}
	if ip := k.ByClientIP(r); ip != "" {
		return "ip:" + ip
	}
	return ""
}

func (k *ClientKeys) fingerprint(b []byte) string {
	m := hmac.New(sha256.New, k.key)
	m.Write(b)
	return hex.EncodeToString(m.Sum(nil)[:12])
}

func ceilSeconds(d time.Duration) string {
	return strconv.Itoa(int(math.Ceil(d.Seconds())))
}
