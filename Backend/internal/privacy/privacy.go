// Package privacy met en œuvre les droits des personnes (étape 10A ; ARCHITECTURE §8 et
// docs/legal/) :
//   - demandes d'exercice des droits (accès, rectification, opposition, suppression, autre) faites
//     depuis l'app (authentifiées) ou reçues par email et enregistrées par l'admin (confirmées par
//     un code envoyé à l'adresse du compte avant tout traitement), avec échéance et suivi audité ;
//   - copie des données (« Télécharger mes données ») : JSON lisible généré par le worker, chiffré
//     (enveloppe, comme les justificatifs), téléchargeable 24 h par la personne seule via un lien
//     signé, puis supprimé ;
//   - suppression du compte : anonymisation immédiate, sessions et appareils révoqués ; station
//     d'un gérant retirée de la recherche, son justificatif suivant sa durée de conservation.
//
// Aucun log ne contient de donnée de la personne : seulement des identifiants et des compteurs.
package privacy

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/auth"
	"gostation/backend/internal/document"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/platform/crypto"
	"gostation/backend/internal/platform/storage"
	"gostation/backend/internal/store"
)

// Codes d'erreur stables.
const (
	CodeExportNotReady   = "data_export.not_ready"          // 409 : copie en cours de génération ou échouée
	CodeExportExpired    = "data_export.expired"            // 410 : copie supprimée (24 h)
	CodeLinkExpired      = "data_export.link_expired"       // 410 : lien de téléchargement périmé
	CodeInvalidSignature = "data_export.invalid_signature"  // 403 : lien altéré
	CodeAccountNotFound  = "data_request.account_not_found" // 404 : aucun compte à cette adresse
	CodeNotVerified      = "data_request.not_verified"      // 409 : identité pas encore confirmée
	CodeAlreadyVerified  = "data_request.already_verified"  // 409
	CodeInvalidCode      = "data_request.invalid_code"      // 400 : code faux, expiré ou épuisé
	CodeClosed           = "data_request.closed"            // 409 : demande déjà close
	CodeWrongType        = "data_request.wrong_type"        // 409 : action sans rapport avec le type
	CodeAccountDeleted   = "data_request.account_deleted"   // 409 : compte déjà supprimé
	CodeTooManyOpen      = "data_request.too_many_open"     // 409 : trop de demandes en cours
	CodeAdminAccount     = "privacy.admin_account"          // 409 : compte admin (CLI)
)

// Règles.
const (
	ExportTTL      = 24 * time.Hour   // conservation d'une copie générée
	LinkTTL        = 15 * time.Minute // validité d'un lien de téléchargement
	CodeTTL        = 7 * 24 * time.Hour
	CodeAttempts   = 5
	MaxOpenPerUser = 5
	staleExport    = time.Hour // une génération en attente depuis plus d'une heure est relancée
	maxDetails     = 2000
)

// Config regroupe les réglages.
type Config struct {
	Timezone        *time.Location
	RequestDeadline time.Duration // délai de réponse (30 jours, provisoire)
	DueSoon         time.Duration // alerte de l'admin (7 jours)
	ContactEmail    string
}

// Mailer met un email en file (*mail.Queue).
type Mailer interface {
	Send(ctx context.Context, m mail.Message) error
}

// Enqueuer met la génération d'une copie en file (*jobs.Client).
type Enqueuer interface {
	EnqueuePersonalExport(ctx context.Context, id uuid.UUID) error
}

// Sessions lit et révoque les sessions d'un compte (*auth.SessionStore).
type Sessions interface {
	List(ctx context.Context, uid uuid.UUID) ([]auth.Session, error)
	RevokeAll(ctx context.Context, uid uuid.UUID, except string) error
}

// Passwords vérifie le mot de passe du compte connecté (*auth.Service).
type Passwords interface {
	VerifyPassword(ctx context.Context, uid uuid.UUID, password string) error
}

// CacheInvalidator invalide le cache de recherche (*searchcache.Invalidator).
type CacheInvalidator interface {
	All(ctx context.Context) error
}

// Deps regroupe les dépendances injectées.
type Deps struct {
	Store     *store.Store
	Storage   storage.Storage
	Envelope  *crypto.Envelope
	Documents *document.Service
	Queue     Enqueuer
	Mailer    Mailer
	Templates *mail.Renderer
	Sessions  Sessions
	Passwords Passwords
	Cache     CacheInvalidator
	Audit     *audit.Logger
	Redis     goredis.UniversalClient
	// Sous-clés HKDF d'APP_SECRET : liens de téléchargement, codes de confirmation, pseudonymes
	// des auteurs de signalements (la même que les exports admin).
	LinkKey      []byte
	CodeKey      []byte
	PseudonymKey []byte
	Log          *slog.Logger
	Clock        func() time.Time
}

// Service met en œuvre les droits des personnes.
type Service struct {
	Deps
	cfg Config
}

// NewService construit le service.
func NewService(cfg Config, d Deps) *Service {
	if d.Clock == nil {
		d.Clock = time.Now
	}
	return &Service{Deps: d, cfg: cfg}
}

func (s *Service) now() time.Time { return s.Clock().UTC() }

// Actor identifie l'auteur d'une action (la personne elle-même ou un admin).
type Actor struct {
	UserID uuid.UUID
	Role   string
}

func (a Actor) entry(action, entityType, entityID string, meta map[string]any) audit.Entry {
	id := a.UserID
	return audit.Entry{ActorID: &id, ActorRole: a.Role, Action: action, EntityType: entityType, EntityID: entityID, Metadata: meta}
}

// Reference renvoie la référence d'une demande, communiquée à la personne (« DR-1A2B3C4D » : la
// partie aléatoire de l'UUID v7, pas son horodatage).
func Reference(id uuid.UUID) string {
	return "DR-" + strings.ToUpper(strings.ReplaceAll(id.String(), "-", "")[24:])
}

// sendMail met un email en file ; un échec est journalisé (sans adresse) sans faire échouer l'action.
func (s *Service) sendMail(ctx context.Context, kind string, m mail.Message, err error) {
	if err == nil {
		err = s.Mailer.Send(ctx, m)
	}
	if err != nil {
		s.Log.ErrorContext(ctx, "privacy: send email", slog.String("email", kind), slog.Any("err", err))
	}
}

func field(name, code, msg string) apperr.FieldError {
	return apperr.FieldError{Field: name, Code: code, Message: msg}
}

func conflict(code, detail string) *apperr.Error {
	return apperr.New(http.StatusConflict, code, detail)
}

func versionConflict() *apperr.Error {
	return apperr.New(http.StatusPreconditionFailed, apperr.CodeVersionConflict,
		"The request was changed in the meantime: reload it and try again.")
}

func ptr[T any](v T) *T { return &v }
