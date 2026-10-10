// Package httpctx transporte dans le context les valeurs propres à une requête HTTP
// (request ID, IP du client). Il ne dépend de rien d'autre dans l'application.
package httpctx

import (
	"context"
	"log/slog"
	"net/netip"
)

type ctxKey int

const (
	requestIDKey ctxKey = iota
	clientIPKey
)

// WithRequestID renvoie un context portant l'identifiant de requête.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

// RequestID renvoie l'identifiant de requête, ou "" s'il est absent.
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// WithClientIP renvoie un context portant l'IP du client (déterminée par le middleware RealIP).
func WithClientIP(ctx context.Context, ip netip.Addr) context.Context {
	return context.WithValue(ctx, clientIPKey, ip)
}

// ClientIP renvoie l'IP du client, si elle a pu être déterminée.
func ClientIP(ctx context.Context) (netip.Addr, bool) {
	ip, ok := ctx.Value(clientIPKey).(netip.Addr)
	return ip, ok && ip.IsValid()
}

// LogAttrs renvoie les attributs de log propres à la requête. L'IP n'en fait volontairement
// pas partie (minimisation des données personnelles).
func LogAttrs(ctx context.Context) []slog.Attr {
	if id := RequestID(ctx); id != "" {
		return []slog.Attr{slog.String("request_id", id)}
	}
	return nil
}
