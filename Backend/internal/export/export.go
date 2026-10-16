// Package export produit les exports admin (étape 7). POST /admin/exports enregistre la demande
// et met une tâche en file ; le worker génère le fichier (CSV UTF-8 avec BOM et « ; » pour Excel en
// français, ou JSON), le chiffre (enveloppe AES-256-GCM, comme les justificatifs) et le stocke.
// GET /admin/exports/{id} donne le statut et un lien de téléchargement signé (HMAC) valable 1 h ;
// le téléchargement exige en plus une session admin. Les fichiers sont supprimés 24 h après leur
// génération par la tâche périodique export:purge. Demandes et téléchargements sont audités.
//
// Jeux de données : stations (avec IFU et RCCM), stocks actuels, stats de recherche agrégées (seuil
// k ≥ 5), signalements (auteur pseudonymisé, jamais l'email), journal d'audit, suivi des demandes
// d'exercice des droits (type, statut, échéance : jamais leur contenu). Jamais la liste des
// utilisateurs, jamais d'email.
package export

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/pagination"
	"gostation/backend/internal/platform/crypto"
	"gostation/backend/internal/platform/storage"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Codes d'erreur stables.
const (
	CodeNotReady         = "export.not_ready"         // 409 : génération en cours ou échouée
	CodeExpired          = "export.expired"           // 410 : fichier supprimé (24 h)
	CodeLinkExpired      = "export.link_expired"      // 410 : lien de plus d'une heure
	CodeInvalidSignature = "export.invalid_signature" // 403 : lien altéré
)

// Règles.
const (
	LinkTTL     = time.Hour      // validité d'un lien de téléchargement
	FileTTL     = 24 * time.Hour // conservation d'un fichier généré
	MaxRows     = 200_000        // au-delà, l'export échoue (too_many_rows)
	DefaultDays = 30             // période par défaut (stats, signalements, audit)
	MaxDays     = 366
	staleAfter  = time.Hour // une demande toujours en attente après 1 h est déclarée échouée
)

// Jeux de données et formats (enums export_dataset, export_format).
const (
	DatasetStations    = string(dbgen.ExportDatasetStations)
	DatasetStocks      = string(dbgen.ExportDatasetStocks)
	DatasetSearchStats = string(dbgen.ExportDatasetSearchStats)
	DatasetReports     = string(dbgen.ExportDatasetReports)
	DatasetAudit       = string(dbgen.ExportDatasetAudit)
	// DatasetDataRequests : suivi des demandes d'exercice des droits (étape 10A), jamais leur contenu.
	DatasetDataRequests = string(dbgen.ExportDatasetDataRequests)
	FormatCSV           = string(dbgen.ExportFormatCsv)
	FormatJSON          = string(dbgen.ExportFormatJson)
)

// Codes d'échec enregistrés (jamais de donnée).
const (
	failTooManyRows = "too_many_rows"
	failGeneration  = "generation_failed"
	failTimeout     = "timeout"
	failQueue       = "queue_unavailable"
)

// Enqueuer met la génération en file (*jobs.Client).
type Enqueuer interface {
	EnqueueExport(ctx context.Context, id uuid.UUID) error
}

// Config regroupe les réglages.
type Config struct {
	Timezone     *time.Location
	StaleAfter   time.Duration
	ExpiredAfter time.Duration
}

// Deps regroupe les dépendances injectées.
type Deps struct {
	Store    *store.Store
	Storage  storage.Storage
	Envelope *crypto.Envelope
	Queue    Enqueuer
	Audit    *audit.Logger
	Log      *slog.Logger
	// LinkKey signe les liens de téléchargement ; PseudonymKey pseudonymise les auteurs des
	// signalements (deux sous-clés HKDF d'APP_SECRET).
	LinkKey      []byte
	PseudonymKey []byte
	Clock        func() time.Time
}

// Service gère les exports.
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

func (s *Service) now() time.Time { return s.Clock() }

// Actor identifie l'admin.
type Actor struct {
	UserID uuid.UUID
	Role   string
}

// Params sont les filtres validés d'un export (période en jours locaux inclus, produit).
type Params struct {
	From      string `json:"from,omitempty"`
	To        string `json:"to,omitempty"`
	ProductID *int16 `json:"productId,omitempty"`
}

// Input est une demande d'export.
type Input struct {
	Dataset   string
	Format    string
	From, To  string
	ProductID *int16
}

func field(name, code, msg string) apperr.FieldError {
	return apperr.FieldError{Field: name, Code: code, Message: msg}
}

// validate contrôle la demande et fixe la période par défaut (30 derniers jours, aujourd'hui compris).
func (s *Service) validate(in Input) (dbgen.ExportDataset, dbgen.ExportFormat, Params, error) {
	var fe []apperr.FieldError
	dataset, format := dbgen.ExportDataset(in.Dataset), dbgen.ExportFormat(in.Format)
	if !dataset.Valid() {
		fe = append(fe, field("dataset", "invalid", "must be stations, stocks, search_stats, reports, audit or data_requests"))
	}
	if in.Format == "" {
		format = dbgen.ExportFormatCsv
	} else if !format.Valid() {
		fe = append(fe, field("format", "invalid", "must be csv or json"))
	}
	var p Params
	periodic := in.Dataset == DatasetSearchStats || in.Dataset == DatasetReports || in.Dataset == DatasetAudit ||
		in.Dataset == DatasetDataRequests
	if !periodic && (in.From != "" || in.To != "") {
		fe = append(fe, field("from", "not_allowed", "stations and stocks are current snapshots, without a period"))
	}
	if in.ProductID != nil && in.Dataset != DatasetSearchStats {
		fe = append(fe, field("productId", "not_allowed", "only search_stats can be filtered by product"))
	}
	if periodic && dataset.Valid() {
		today := s.now().In(s.cfg.Timezone)
		today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, s.cfg.Timezone)
		first, last := today.AddDate(0, 0, -(DefaultDays-1)), today
		var err error
		if in.From != "" {
			if first, err = time.ParseInLocation(time.DateOnly, in.From, s.cfg.Timezone); err != nil {
				fe = append(fe, field("from", "invalid", "must be a date such as 2026-10-01"))
			}
		}
		if in.To != "" {
			if last, err = time.ParseInLocation(time.DateOnly, in.To, s.cfg.Timezone); err != nil {
				fe = append(fe, field("to", "invalid", "must be a date such as 2026-10-07"))
			}
		}
		switch {
		case last.Before(first):
			fe = append(fe, field("to", "out_of_range", "must be on or after from"))
		case last.After(today):
			fe = append(fe, field("to", "out_of_range", "must not be in the future"))
		case last.Sub(first) > (MaxDays-1)*24*time.Hour:
			fe = append(fe, field("from", "out_of_range", fmt.Sprintf("the period must not exceed %d days", MaxDays)))
		}
		p.From, p.To, p.ProductID = first.Format(time.DateOnly), last.Format(time.DateOnly), in.ProductID
	}
	if len(fe) > 0 {
		return "", "", Params{}, apperr.Validation(fe...)
	}
	return dataset, format, p, nil
}

// Export est une demande d'export et, une fois prête, son lien de téléchargement.
type Export struct {
	dbgen.GetExportRow
	Params       Params
	DownloadPath string
	LinkExpires  *time.Time
}

func (s *Service) view(r dbgen.GetExportRow) Export {
	e := Export{GetExportRow: r}
	_ = json.Unmarshal(r.Params, &e.Params)
	if r.Status == dbgen.ExportStatusReady {
		exp := s.now().Add(LinkTTL).Truncate(time.Second)
		e.DownloadPath = fmt.Sprintf("/api/v1/admin/exports/%s/download?expires=%d&signature=%s", r.ID, exp.Unix(), s.sign(r.ID, exp.Unix()))
		e.LinkExpires = &exp
	}
	return e
}

func (s *Service) sign(id uuid.UUID, expires int64) string {
	m := hmac.New(sha256.New, s.LinkKey)
	m.Write([]byte(id.String() + "|" + strconv.FormatInt(expires, 10)))
	return hex.EncodeToString(m.Sum(nil))
}

// Request enregistre une demande d'export et met sa génération en file.
func (s *Service) Request(ctx context.Context, a Actor, in Input) (Export, error) {
	dataset, format, p, err := s.validate(in)
	if err != nil {
		return Export{}, err
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return Export{}, err
	}
	id, err := s.Store.CreateExport(ctx, dbgen.CreateExportParams{RequestedBy: &a.UserID, Dataset: dataset, Format: format, Params: raw})
	if err != nil {
		return Export{}, fmt.Errorf("export: create: %w", err)
	}
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &a.UserID, ActorRole: a.Role, Action: audit.ActionExportRequested, EntityType: "export", EntityID: id.String(),
		Metadata: map[string]any{"dataset": string(dataset), "format": string(format), "params": p},
	})
	if err := s.Queue.EnqueueExport(ctx, id); err != nil {
		_, _ = s.Store.FailExport(context.WithoutCancel(ctx), dbgen.FailExportParams{ID: id, Error: ptr(failQueue)})
		return Export{}, apperr.Unavailable("The export could not be queued, try again later.").Wrap(err)
	}
	return s.Get(ctx, id)
}

func ptr[T any](v T) *T { return &v }

// Get renvoie un export (et un lien neuf, valable 1 h, s'il est prêt).
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Export, error) {
	r, err := s.Store.GetExport(ctx, id)
	if err != nil {
		return Export{}, fmt.Errorf("export: load: %w", store.Translate(err))
	}
	return s.view(r), nil
}

// Page est une page d'exports.
type Page struct {
	Items      []Export
	NextCursor string
}

// List liste les exports, les plus récents d'abord.
func (s *Service) List(ctx context.Context, cursor string, limit int) (Page, error) {
	n, err := pagination.Limit(limit)
	if err != nil {
		return Page{}, err
	}
	p := dbgen.ListExportsParams{PageSize: int32(n + 1)} //nolint:gosec // ≤ 101
	if cursor != "" {
		id, err := uuid.Parse(cursor)
		if err != nil {
			return Page{}, apperr.BadRequest(apperr.CodeInvalidParameter, "Invalid cursor.")
		}
		p.Cursor = &id
	}
	rows, err := s.Store.ListExports(ctx, p)
	if err != nil {
		return Page{}, fmt.Errorf("export: list: %w", err)
	}
	page := Page{Items: make([]Export, 0, min(len(rows), n))}
	for i, r := range rows {
		if i == n {
			page.NextCursor = rows[n-1].ID.String()
			break
		}
		page.Items = append(page.Items, s.view(dbgen.GetExportRow(r)))
	}
	return page, nil
}

// ErrPermanent marque un échec définitif de génération (pas de nouvel essai).
var ErrPermanent = errors.New("export: permanent failure")

// Generate produit, chiffre et stocke le fichier d'un export en attente (tâche du worker). Une
// erreur transitoire est renvoyée (retry asynq) ; un export trop volumineux échoue sans retry.
func (s *Service) Generate(ctx context.Context, id uuid.UUID) error {
	r, err := s.Store.GetExport(ctx, id)
	if store.IsNotFound(err) {
		return fmt.Errorf("%w: export %s not found", ErrPermanent, id)
	}
	if err != nil {
		return fmt.Errorf("export: load: %w", err)
	}
	if r.Status != dbgen.ExportStatusPending {
		return nil // déjà traité (tâche rejouée)
	}
	var p Params
	if err := json.Unmarshal(r.Params, &p); err != nil {
		s.Fail(ctx, id, failGeneration)
		return fmt.Errorf("%w: params: %v", ErrPermanent, err) //nolint:errorlint // l'erreur JSON n'a pas à être inspectée
	}
	t, err := s.build(ctx, string(r.Dataset), p)
	if err != nil {
		return err
	}
	if len(t.rows) > MaxRows {
		s.Fail(ctx, id, failTooManyRows)
		return fmt.Errorf("%w: %d rows", ErrPermanent, len(t.rows))
	}
	var data []byte
	if r.Format == dbgen.ExportFormatJson {
		data, err = writeJSON(string(r.Dataset), p, s.now(), t)
	} else {
		data, err = writeCSV(t, s.cfg.Timezone)
	}
	if err != nil {
		s.Fail(ctx, id, failGeneration)
		return fmt.Errorf("%w: encode: %v", ErrPermanent, err) //nolint:errorlint // idem
	}
	key := "exports/" + id.String() + ".bin"
	ct, wrapped, err := s.Envelope.Seal(data, []byte(key))
	if err != nil {
		return fmt.Errorf("export: encrypt: %w", err)
	}
	if err := s.Storage.Put(ctx, key, ct); err != nil {
		return fmt.Errorf("export: store: %w", err)
	}
	sum := sha256.Sum256(data)
	rows := int32(len(t.rows)) //nolint:gosec // ≤ MaxRows
	n, err := s.Store.CompleteExport(ctx, dbgen.CompleteExportParams{
		ID: id, ObjectKey: &key, WrappedKey: wrapped, Sha256: sum[:], SizeBytes: ptr(int64(len(data))),
		RowCount: &rows, ExpiresAt: ptr(s.now().Add(FileTTL)),
	})
	if err != nil || n == 0 {
		_ = s.Storage.Delete(context.WithoutCancel(ctx), key)
		if err != nil {
			return fmt.Errorf("export: complete: %w", err)
		}
	}
	s.Log.InfoContext(ctx, "export generated", slog.String("export_id", id.String()), slog.String("dataset", string(r.Dataset)), slog.Int("rows", len(t.rows)))
	return nil
}

// Fail marque un export en attente comme échoué (code générique).
func (s *Service) Fail(ctx context.Context, id uuid.UUID, code string) {
	if code == "" {
		code = failGeneration
	}
	if _, err := s.Store.FailExport(context.WithoutCancel(ctx), dbgen.FailExportParams{ID: id, Error: &code}); err != nil {
		s.Log.ErrorContext(ctx, "export: mark failed", slog.String("export_id", id.String()), slog.Any("err", err))
	}
}

// Purge supprime les fichiers générés il y a 24 h ou plus (tâche périodique du worker) et déclare
// échouées les demandes restées en attente plus d'une heure. Renvoie le nombre de fichiers supprimés.
func (s *Service) Purge(ctx context.Context) (int, error) {
	now := s.now()
	if _, err := s.Store.FailStalePendingExports(ctx, dbgen.FailStalePendingExportsParams{Before: now.Add(-staleAfter), Error: ptr(failTimeout)}); err != nil {
		return 0, fmt.Errorf("export: fail stale: %w", err)
	}
	rows, err := s.Store.ListExpiredExports(ctx, now)
	if err != nil {
		return 0, fmt.Errorf("export: list expired: %w", err)
	}
	purged := 0
	for _, r := range rows {
		if r.ObjectKey != nil {
			if err := s.Storage.Delete(ctx, *r.ObjectKey); err != nil && !errors.Is(err, storage.ErrNotFound) {
				return purged, fmt.Errorf("export: delete file: %w", err)
			}
		}
		if _, err := s.Store.ExpireExport(ctx, r.ID); err != nil {
			return purged, fmt.Errorf("export: expire: %w", err)
		}
		purged++
	}
	return purged, nil
}

// File est un fichier d'export déchiffré.
type File struct {
	Name        string
	ContentType string
	Data        []byte
}

// Download vérifie le lien signé puis renvoie le fichier déchiffré (audité).
func (s *Service) Download(ctx context.Context, a Actor, id uuid.UUID, expires, signature string) (File, error) {
	exp, err := strconv.ParseInt(expires, 10, 64)
	if err != nil || !hmac.Equal([]byte(signature), []byte(s.sign(id, exp))) {
		return File{}, apperr.New(http.StatusForbidden, CodeInvalidSignature, "Invalid download link.")
	}
	if s.now().Unix() > exp {
		return File{}, apperr.New(http.StatusGone, CodeLinkExpired, "This download link has expired: reload the export to get a new one.")
	}
	r, err := s.Store.GetExport(ctx, id)
	if err != nil {
		return File{}, fmt.Errorf("export: load: %w", store.Translate(err))
	}
	switch r.Status {
	case dbgen.ExportStatusReady:
	case dbgen.ExportStatusExpired:
		return File{}, apperr.New(http.StatusGone, CodeExpired, "This export file was deleted after 24 hours.")
	default:
		return File{}, apperr.New(http.StatusConflict, CodeNotReady, "This export is not ready.").WithMeta("exportStatus", string(r.Status))
	}
	ct, err := s.Storage.Get(ctx, *r.ObjectKey)
	if err != nil {
		return File{}, fmt.Errorf("export: load file: %w", err)
	}
	data, err := s.Envelope.Open(ct, r.WrappedKey, []byte(*r.ObjectKey))
	if err != nil {
		return File{}, fmt.Errorf("export: decrypt: %w", err)
	}
	if sum := sha256.Sum256(data); !bytes.Equal(sum[:], r.Sha256) {
		return File{}, errors.New("export: integrity check failed")
	}
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &a.UserID, ActorRole: a.Role, Action: audit.ActionExportDownloaded, EntityType: "export", EntityID: id.String(),
		Metadata: map[string]any{"dataset": string(r.Dataset), "format": string(r.Format)},
	})
	ext, ctype := "csv", "text/csv; charset=utf-8"
	if r.Format == dbgen.ExportFormatJson {
		ext, ctype = "json", "application/json"
	}
	name := fmt.Sprintf("gostation-%s-%s.%s", r.Dataset, r.CreatedAt.In(s.cfg.Timezone).Format("20060102-1504"), ext)
	return File{Name: name, ContentType: ctype, Data: data}, nil
}
