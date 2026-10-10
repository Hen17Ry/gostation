// Package audit écrit le journal d'audit (table audit_logs, en ajout seul). Une écriture
// d'audit ne fait jamais échouer la requête : un échec est journalisé en erreur.
package audit

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/google/uuid"

	"gostation/backend/internal/http/httpctx"
	"gostation/backend/internal/store/dbgen"
)

// Actions journalisées (identifiants stables, en anglais).
const (
	ActionUserRegistered       = "user.registered"
	ActionManagerRegistered    = "manager.registered"
	ActionEmailVerified        = "auth.email_verified"
	ActionLoginSucceeded       = "auth.login_succeeded"
	ActionLoginFailed          = "auth.login_failed"
	ActionAdminLoginSucceeded  = "auth.admin_login_succeeded"
	ActionAdminLoginFailed     = "auth.admin_login_failed"
	ActionTwoFactorEnabled     = "auth.2fa_enabled"
	ActionTwoFactorFailed      = "auth.2fa_failed"
	ActionRecoveryCodeUsed     = "auth.recovery_code_used"
	ActionRefreshReuseDetected = "auth.refresh_reuse_detected"
	ActionLogout               = "auth.logout"
	ActionLogoutAll            = "auth.logout_all"
	ActionSessionRevoked       = "auth.session_revoked"
	ActionPasswordChanged      = "auth.password_changed"
	ActionPasswordReset        = "auth.password_reset"
	ActionAccountDeleted       = "user.account_deleted"
	ActionAdminCreated         = "admin.created"
	ActionAdminTwoFactorReset  = "admin.2fa_reset"
	ActionDocumentViewed       = "admin.document_viewed"
)

// Entry est une entrée du journal. Metadata ne contient aucune donnée personnelle superflue
// (jamais de mot de passe, de token, de position ; un email n'y figure qu'en empreinte HMAC).
type Entry struct {
	ActorID    *uuid.UUID
	ActorRole  string
	Action     string
	EntityType string
	EntityID   string
	Metadata   map[string]any
}

// Inserter est la requête sqlc utilisée.
type Inserter interface {
	InsertAuditLog(ctx context.Context, arg dbgen.InsertAuditLogParams) error
}

// Logger écrit les entrées.
type Logger struct {
	db  Inserter
	log *slog.Logger
}

// New construit le logger d'audit.
func New(db Inserter, log *slog.Logger) *Logger { return &Logger{db: db, log: log} }

// Log écrit l'entrée ; le request ID est repris du context.
func (l *Logger) Log(ctx context.Context, e Entry) {
	meta := e.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		l.log.ErrorContext(ctx, "audit: encode metadata", slog.String("action", e.Action), slog.Any("err", err))
		raw = []byte("{}")
	}
	p := dbgen.InsertAuditLogParams{ActorID: e.ActorID, Action: e.Action, EntityType: e.EntityType, Metadata: raw}
	if e.ActorRole != "" {
		role := dbgen.UserRole(e.ActorRole)
		p.ActorRole = &role
	}
	if e.EntityID != "" {
		p.EntityID = &e.EntityID
	}
	if id := httpctx.RequestID(ctx); id != "" {
		p.RequestID = &id
	}
	// Contexte détaché : l'entrée est écrite même si le client a fermé la connexion.
	if err := l.db.InsertAuditLog(context.WithoutCancel(ctx), p); err != nil {
		l.log.ErrorContext(ctx, "audit: write entry", slog.String("action", e.Action), slog.Any("err", err))
	}
}
