// Package logging construit le logger slog de l'application (JSON par défaut).
package logging

import (
	"context"
	"io"
	"log/slog"
)

// Formats acceptés pour LOG_FORMAT.
const (
	FormatJSON = "json"
	FormatText = "text"
)

// New construit le logger. ctxAttrs (facultatif) ajoute à chaque appel *Context les attributs
// propres à la requête, par exemple le request_id.
func New(w io.Writer, level slog.Level, format string, ctxAttrs func(context.Context) []slog.Attr) *slog.Logger {
	opts := &slog.HandlerOptions{Level: level}
	var h slog.Handler
	if format == FormatText {
		h = slog.NewTextHandler(w, opts)
	} else {
		h = slog.NewJSONHandler(w, opts)
	}
	if ctxAttrs != nil {
		h = contextHandler{Handler: h, attrs: ctxAttrs}
	}
	return slog.New(h)
}

type contextHandler struct {
	slog.Handler
	attrs func(context.Context) []slog.Attr
}

func (h contextHandler) Handle(ctx context.Context, r slog.Record) error {
	if ctx != nil {
		r.AddAttrs(h.attrs(ctx)...)
	}
	return h.Handler.Handle(ctx, r)
}

func (h contextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return contextHandler{Handler: h.Handler.WithAttrs(attrs), attrs: h.attrs}
}

func (h contextHandler) WithGroup(name string) slog.Handler {
	return contextHandler{Handler: h.Handler.WithGroup(name), attrs: h.attrs}
}
