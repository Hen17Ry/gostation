// Package middleware regroupe les middlewares HTTP de l'API : request ID, IP réelle, journal
// d'accès, recover, timeout, taille maximale du corps et rate limiting.
package middleware

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/netip"
	"net/url"
	"runtime/debug"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/http/respond"
)

// HeaderRequestID est l'en-tête qui porte l'identifiant de requête, en entrée comme en sortie.
const HeaderRequestID = "X-Request-ID"

// RequestID reprend l'X-Request-ID du client s'il est sûr (1 à 64 caractères [A-Za-z0-9._:-]),
// sinon génère un UUIDv7. L'identifiant est renvoyé en en-tête et placé dans le context.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(HeaderRequestID)
		if !validRequestID(id) {
			id = newRequestID()
		}
		w.Header().Set(HeaderRequestID, id)
		next.ServeHTTP(w, r.WithContext(httpctx.WithRequestID(r.Context(), id)))
	})
}

func validRequestID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, c := range id {
		ok := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' ||
			c == '.' || c == '_' || c == ':' || c == '-'
		if !ok {
			return false
		}
	}
	return true
}

func newRequestID() string {
	if id, err := uuid.NewV7(); err == nil {
		return id.String()
	}
	return uuid.NewString()
}

// RealIP détermine l'IP du client et la place dans le context. X-Forwarded-For n'est lu que si
// la connexion vient d'un proxy de confiance (HTTP_TRUSTED_PROXIES) : sinon n'importe quel
// client pourrait choisir son IP et contourner le rate limiting. On parcourt l'en-tête de
// droite à gauche ; la première adresse hors des proxys de confiance est celle du client.
func RealIP(trusted []netip.Prefix) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			if ip := clientIP(r, trusted); ip.IsValid() {
				ctx = httpctx.WithClientIP(ctx, ip)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func clientIP(r *http.Request, trusted []netip.Prefix) netip.Addr {
	var addr netip.Addr
	if ap, err := netip.ParseAddrPort(r.RemoteAddr); err == nil {
		addr = ap.Addr().Unmap()
	} else if a, err := netip.ParseAddr(r.RemoteAddr); err == nil {
		addr = a.Unmap()
	}
	if !addr.IsValid() || !isTrusted(addr, trusted) {
		return addr
	}
	hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		hop, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			return addr // en-tête corrompu : on s'arrête au dernier saut fiable
		}
		hop = hop.Unmap()
		if !isTrusted(hop, trusted) {
			return hop
		}
		addr = hop
	}
	return addr
}

func isTrusted(ip netip.Addr, trusted []netip.Prefix) bool {
	for _, p := range trusted {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// loggableParams sont les paramètres de query string dont la valeur peut être journalisée. Tous
// les autres (lat, lng de /search et /routes, recherche texte de l'admin, curseurs…) sont
// masqués : une position ne doit jamais atteindre les logs (CLAUDE.md, règle 10).
var loggableParams = map[string]bool{"product_id": true, "station_id": true, "status": true, "limit": true, "needs_review": true}

// maskedQuery renvoie la query string avec les valeurs sensibles remplacées par « *** ».
func maskedQuery(raw string) string {
	if raw == "" {
		return ""
	}
	parts := strings.Split(raw, "&")
	for i, kv := range parts {
		k, _, _ := strings.Cut(kv, "=")
		key, err := url.QueryUnescape(k)
		switch {
		case err != nil:
			parts[i] = "?=***"
		case !loggableParams[key]:
			parts[i] = url.QueryEscape(key) + "=***"
		}
	}
	return strings.Join(parts, "&")
}

// AccessLog journalise chaque requête : méthode, route, statut, taille, durée et query string
// masquée (voir loggableParams). Jamais l'IP. Les sondes de santé sont en debug.
func AccessLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
			defer func() {
				status := ww.Status()
				if status == 0 {
					status = http.StatusOK
				}
				route := ""
				if rctx := chi.RouteContext(r.Context()); rctx != nil {
					route = rctx.RoutePattern()
				}
				level := slog.LevelInfo
				switch {
				case status >= http.StatusInternalServerError:
					level = slog.LevelError
				case route == "/healthz" || route == "/readyz":
					level = slog.LevelDebug
				}
				attrs := []slog.Attr{
					slog.String("method", r.Method),
					slog.String("route", route),
					slog.String("path", r.URL.Path),
				}
				if q := maskedQuery(r.URL.RawQuery); q != "" {
					attrs = append(attrs, slog.String("query", q))
				}
				attrs = append(attrs,
					slog.Int("status", status),
					slog.Int("bytes", ww.BytesWritten()),
					slog.Float64("duration_ms", float64(time.Since(start).Microseconds())/1000))
				log.LogAttrs(r.Context(), level, "http request", attrs...)
			}()
			next.ServeHTTP(ww, r)
		})
	}
}

// Recover intercepte les panics, journalise la pile et répond 500 en problem+json.
// http.ErrAbortHandler est relancé : c'est le signal standard d'abandon d'une réponse.
func Recover(log *slog.Logger, rs *respond.Responder) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				rec := recover()
				if rec == nil {
					return
				}
				if err, ok := rec.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					panic(rec)
				}
				log.ErrorContext(r.Context(), "panic recovered",
					slog.String("panic", fmt.Sprint(rec)),
					slog.String("stack", string(debug.Stack())))
				rs.WriteProblem(w, r, apperr.Internal(fmt.Errorf("panic: %v", rec)))
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// Timeout borne la durée de traitement via le context. Les handlers et les requêtes SQL
// le respectent ; une erreur context.DeadlineExceeded est rendue en 504 (request.timeout).
func Timeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// MaxBodyBytes limite la taille du corps : refus immédiat si Content-Length dépasse la limite,
// sinon lecture bornée (http.MaxBytesReader → 413 à la lecture).
func MaxBodyBytes(limit int64, rs *respond.Responder) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength > limit {
				rs.Error(w, r, &http.MaxBytesError{Limit: limit})
				return
			}
			if r.Body != nil && r.Body != http.NoBody {
				r.Body = http.MaxBytesReader(w, r.Body, limit)
			}
			next.ServeHTTP(w, r)
		})
	}
}
