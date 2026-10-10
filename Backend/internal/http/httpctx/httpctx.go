// Package httpctx transporte dans le context les valeurs propres à une requête HTTP
// (request ID, IP du client). Il ne dépend de rien d'autre dans l'application.
package httpctx

import (
	"context"
	"log/slog"
	"net/netip"

	"github.com/google/uuid"
)

type ctxKey int

const (
	requestIDKey ctxKey = iota
	clientIPKey
	principalKey
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

// Principal est l'utilisateur authentifié de la requête.
type Principal struct {
	UserID    uuid.UUID
	Role      string
	SessionID string
	// MFA vaut true pour une session admin ouverte après la 2FA.
	MFA bool
	// ViaCookie : authentifié par cookie (admin web), donc soumis au contrôle CSRF.
	ViaCookie bool
}

// WithPrincipal renvoie un context portant l'utilisateur authentifié.
func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey, p)
}

// PrincipalFrom renvoie l'utilisateur authentifié, s'il y en a un.
func PrincipalFrom(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey).(Principal)
	return p, ok
}

// LogAttrs renvoie les attributs de log propres à la requête : request_id et, si la requête est
// authentifiée, user_id. L'IP n'en fait volontairement pas partie (minimisation).
func LogAttrs(ctx context.Context) []slog.Attr {
	var attrs []slog.Attr
	if id := RequestID(ctx); id != "" {
		attrs = append(attrs, slog.String("request_id", id))
	}
	if p, ok := PrincipalFrom(ctx); ok {
		attrs = append(attrs, slog.String("user_id", p.UserID.String()))
	}
	return attrs
}
