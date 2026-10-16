package privacy

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
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
	"gostation/backend/internal/document"
	"gostation/backend/internal/platform/storage"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// ExportFormat identifie la structure de la copie (versionnée pour la personne qui la relit).
const ExportFormat = "gostation-personal-data/1"

// ExportView est l'état de la dernière copie de la personne.
type ExportView struct {
	ID          uuid.UUID
	Status      string // none, pending, ready, failed, expired
	CreatedAt   *time.Time
	ExpiresAt   *time.Time
	SizeBytes   *int64
	DownloadURL *string // lien signé, valable LinkTTL, quand la copie est prête
}

// ErrPermanent marque un échec définitif de génération (pas de nouvel essai).
var ErrPermanent = errors.New("privacy: permanent failure")

// RequestExport demande une copie des données : la copie prête ou en cours est réutilisée, sinon
// une demande (type export, traitée automatiquement) et une génération sont créées.
func (s *Service) RequestExport(ctx context.Context, a Actor) (ExportView, error) {
	if a.Role == string(dbgen.UserRoleAdmin) {
		return ExportView{}, conflict(CodeAdminAccount, "Admin accounts are handled with the admin CLI.")
	}
	now := s.now()
	if last, err := s.Store.GetLatestPersonalExport(ctx, a.UserID); err == nil {
		switch {
		case last.Status == dbgen.PersonalExportStatusPending && last.CreatedAt.After(now.Add(-staleExport)):
			return s.exportView(last), nil
		case last.Status == dbgen.PersonalExportStatusReady && last.ExpiresAt != nil && last.ExpiresAt.After(now):
			return s.exportView(last), nil
		}
	} else if !store.IsNotFound(err) {
		return ExportView{}, fmt.Errorf("privacy: latest export: %w", err)
	}
	var exportID uuid.UUID
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		reqID, err := q.InsertDataRequest(ctx, dbgen.InsertDataRequestParams{
			UserID: &a.UserID, Type: dbgen.DataRequestTypeExport, Status: dbgen.DataRequestStatusInProgress,
			Source: dbgen.DataRequestSourceApp, DueAt: now.Add(s.cfg.RequestDeadline), VerifiedAt: &now,
		})
		if err != nil {
			return err
		}
		exportID, err = q.InsertPersonalExport(ctx, dbgen.InsertPersonalExportParams{UserID: a.UserID, RequestID: &reqID})
		return err
	})
	if err != nil {
		return ExportView{}, fmt.Errorf("privacy: create export: %w", err)
	}
	if err := s.Queue.EnqueuePersonalExport(ctx, exportID); err != nil {
		return ExportView{}, apperr.Unavailable("The export could not be queued: try again later.").Wrap(err)
	}
	s.Audit.Log(ctx, a.entry(audit.ActionDataExportRequested, "personal_export", exportID.String(), nil))
	return s.ExportStatus(ctx, a)
}

// GenerateExportFor génère une copie pour la personne d'une demande confirmée (admin) : elle la
// télécharge dans l'app, l'admin n'en voit jamais le contenu.
func (s *Service) GenerateExportFor(ctx context.Context, admin Actor, id uuid.UUID, version int32) (AdminRequest, error) {
	r, err := s.load(ctx, id)
	if err != nil {
		return AdminRequest{}, err
	}
	if err := s.ready(r); err != nil {
		return AdminRequest{}, err
	}
	if r.UserID == nil || r.UserStatus == nil || *r.UserStatus == dbgen.UserStatusPendingDeletion {
		return AdminRequest{}, conflict(CodeAccountDeleted, "The account of this request was deleted.")
	}
	if err := s.markInProgress(ctx, admin, id, version); err != nil {
		return AdminRequest{}, err
	}
	exportID, err := s.Store.InsertPersonalExport(ctx, dbgen.InsertPersonalExportParams{UserID: *r.UserID, RequestID: &id})
	if err != nil {
		return AdminRequest{}, fmt.Errorf("privacy: create export: %w", err)
	}
	if err := s.Queue.EnqueuePersonalExport(ctx, exportID); err != nil {
		return AdminRequest{}, apperr.Unavailable("The export could not be queued: try again later.").Wrap(err)
	}
	s.Audit.Log(ctx, admin.entry(audit.ActionDataExportRequested, "personal_export", exportID.String(),
		map[string]any{"requestId": id.String()}))
	return s.Get(ctx, id)
}

// ExportStatus renvoie la dernière copie de la personne (et un lien neuf si elle est prête).
func (s *Service) ExportStatus(ctx context.Context, a Actor) (ExportView, error) {
	r, err := s.Store.GetLatestPersonalExport(ctx, a.UserID)
	if store.IsNotFound(err) {
		return ExportView{Status: "none"}, nil
	}
	if err != nil {
		return ExportView{}, fmt.Errorf("privacy: latest export: %w", err)
	}
	return s.exportView(r), nil
}

func (s *Service) exportView(r dbgen.PersonalExport) ExportView {
	v := ExportView{ID: r.ID, Status: string(r.Status), CreatedAt: &r.CreatedAt, ExpiresAt: r.ExpiresAt, SizeBytes: r.SizeBytes}
	now := s.now()
	switch {
	case r.Status == dbgen.PersonalExportStatusReady && r.ExpiresAt != nil && !r.ExpiresAt.After(now):
		v.Status = "expired"
	case r.Status == dbgen.PersonalExportStatusReady:
		exp := now.Add(LinkTTL).Unix()
		u := fmt.Sprintf("/api/v1/me/data-export/%s/download?expires=%d&signature=%s", r.ID, exp, s.sign(r.ID, exp))
		v.DownloadURL = &u
	case r.Status == dbgen.PersonalExportStatusPending && r.CreatedAt.Before(now.Add(-staleExport)):
		v.Status = "failed"
	}
	return v
}

func (s *Service) sign(id uuid.UUID, exp int64) string {
	m := hmac.New(sha256.New, s.LinkKey)
	m.Write([]byte(id.String() + "|" + strconv.FormatInt(exp, 10)))
	return hex.EncodeToString(m.Sum(nil))
}

// File est une copie déchiffrée.
type File struct {
	Name        string
	ContentType string
	Data        []byte
}

// DownloadExport vérifie le lien signé et que la copie appartient à la personne connectée, puis
// renvoie le fichier déchiffré (audité).
func (s *Service) DownloadExport(ctx context.Context, a Actor, id uuid.UUID, expires, signature string) (File, error) {
	exp, err := strconv.ParseInt(expires, 10, 64)
	if err != nil || !hmac.Equal([]byte(signature), []byte(s.sign(id, exp))) {
		return File{}, apperr.New(http.StatusForbidden, CodeInvalidSignature, "Invalid download link.")
	}
	if s.now().Unix() > exp {
		return File{}, apperr.New(http.StatusGone, CodeLinkExpired, "This download link has expired: reload the page to get a new one.")
	}
	r, err := s.Store.GetPersonalExport(ctx, id)
	if store.IsNotFound(err) || (err == nil && r.UserID != a.UserID) {
		return File{}, apperr.NotFound("Export not found.")
	}
	if err != nil {
		return File{}, fmt.Errorf("privacy: load export: %w", err)
	}
	if r.Status != dbgen.PersonalExportStatusReady {
		return File{}, apperr.New(http.StatusConflict, CodeExportNotReady, "This copy of your data is not ready.")
	}
	if r.ExpiresAt == nil || !r.ExpiresAt.After(s.now()) {
		return File{}, apperr.New(http.StatusGone, CodeExportExpired, "This copy of your data was deleted after 24 hours: ask for a new one.")
	}
	ct, err := s.Storage.Get(ctx, *r.ObjectKey)
	if errors.Is(err, storage.ErrNotFound) {
		return File{}, apperr.New(http.StatusGone, CodeExportExpired, "This copy of your data was deleted after 24 hours: ask for a new one.")
	}
	if err != nil {
		return File{}, fmt.Errorf("privacy: load file: %w", err)
	}
	data, err := s.Envelope.Open(ct, r.WrappedKey, []byte(*r.ObjectKey))
	if err != nil {
		return File{}, fmt.Errorf("privacy: decrypt: %w", err)
	}
	if sum := sha256.Sum256(data); !bytes.Equal(sum[:], r.Sha256) {
		return File{}, errors.New("privacy: integrity check failed")
	}
	s.Audit.Log(ctx, a.entry(audit.ActionDataExportDownloaded, "personal_export", id.String(), nil))
	name := "gostation-mes-donnees-" + r.CreatedAt.In(s.cfg.Timezone).Format("20060102-1504") + ".json"
	return File{Name: name, ContentType: "application/json", Data: data}, nil
}

// GenerateExport rassemble les données de la personne, chiffre et stocke la copie (tâche du
// worker). Une copie demandée depuis l'app clôt sa demande ; la personne est prévenue par email.
func (s *Service) GenerateExport(ctx context.Context, id uuid.UUID) error {
	r, err := s.Store.GetPersonalExport(ctx, id)
	if store.IsNotFound(err) {
		return fmt.Errorf("%w: export %s not found", ErrPermanent, id)
	}
	if err != nil {
		return fmt.Errorf("privacy: load export: %w", err)
	}
	if r.Status != dbgen.PersonalExportStatusPending {
		return nil // déjà traitée (tâche rejouée)
	}
	data, err := s.collect(ctx, r.UserID)
	if err != nil {
		return err
	}
	key := "personal-exports/" + id.String() + ".json.bin"
	ct, wrapped, err := s.Envelope.Seal(data, []byte(key))
	if err != nil {
		return fmt.Errorf("privacy: encrypt: %w", err)
	}
	if err := s.Storage.Put(ctx, key, ct); err != nil {
		return fmt.Errorf("privacy: store: %w", err)
	}
	sum := sha256.Sum256(data)
	now := s.now()
	expires := now.Add(ExportTTL)
	n, err := s.Store.CompletePersonalExport(ctx, dbgen.CompletePersonalExportParams{
		ID: id, ObjectKey: &key, WrappedKey: wrapped, Sha256: sum[:], SizeBytes: ptr(int64(len(data))),
		Now: &now, ExpiresAt: &expires,
	})
	if err != nil || n == 0 {
		_ = s.Storage.Delete(context.WithoutCancel(ctx), key)
		if err != nil {
			return fmt.Errorf("privacy: complete export: %w", err)
		}
		return nil
	}
	s.Log.InfoContext(ctx, "privacy: export generated", slog.String("export_id", id.String()), slog.Int("bytes", len(data)))
	if r.RequestID != nil {
		if req, err := s.Store.GetDataRequest(ctx, *r.RequestID); err == nil &&
			req.Source == dbgen.DataRequestSourceApp && req.Type == dbgen.DataRequestTypeExport && req.HandledBy == nil && open(req.Status) {
			note := "Copie générée et mise à disposition dans l'application pendant 24 heures."
			if _, err := s.Store.CloseDataRequest(ctx, dbgen.CloseDataRequestParams{
				ID: req.ID, Status: dbgen.DataRequestStatusCompleted, ResponseNote: &note, Now: &now,
			}); err != nil {
				s.Log.ErrorContext(ctx, "privacy: close export request", slog.String("request_id", req.ID.String()), slog.Any("err", err))
			}
		}
	}
	if u, err := s.Store.GetUserContact(ctx, r.UserID); err == nil && u.Status != dbgen.UserStatusPendingDeletion {
		m, err := s.Templates.DataExportReady(u.Email, u.FirstName, expires)
		s.sendMail(ctx, "data_export_ready", m, err)
	}
	return nil
}

// FailExport marque une génération en attente comme échouée (code générique, jamais de donnée).
func (s *Service) FailExport(ctx context.Context, id uuid.UUID) {
	code := "generation_failed"
	if _, err := s.Store.FailPersonalExport(context.WithoutCancel(ctx), dbgen.FailPersonalExportParams{ID: id, Error: &code, Now: ptr(s.now())}); err != nil {
		s.Log.ErrorContext(ctx, "privacy: mark export failed", slog.String("export_id", id.String()), slog.Any("err", err))
	}
}

// CountExpiredExports compte les copies à supprimer (simulation de purge).
func (s *Service) CountExpiredExports(ctx context.Context, now time.Time) (int64, error) {
	return s.Store.CountExpiredPersonalExports(ctx, dbgen.CountExpiredPersonalExportsParams{Now: now, StaleBefore: now.Add(-staleExport)})
}

// PurgeExportsBatch supprime un lot de copies expirées (fichier et ligne) et renvoie leur nombre.
func (s *Service) PurgeExportsBatch(ctx context.Context, now time.Time, batch int32) (int64, error) {
	rows, err := s.Store.ListExpiredPersonalExports(ctx, dbgen.ListExpiredPersonalExportsParams{
		Now: now, StaleBefore: now.Add(-staleExport), BatchSize: batch,
	})
	if err != nil {
		return 0, fmt.Errorf("privacy: list expired exports: %w", err)
	}
	var n int64
	for _, r := range rows {
		if r.ObjectKey != nil {
			if err := s.Storage.Delete(ctx, *r.ObjectKey); err != nil && !errors.Is(err, storage.ErrNotFound) {
				return n, fmt.Errorf("privacy: delete export file: %w", err)
			}
		}
		if err := s.Store.DeletePersonalExport(ctx, r.ID); err != nil {
			return n, fmt.Errorf("privacy: delete export: %w", err)
		}
		n++
	}
	return n, nil
}

// about décrit chaque rubrique de la copie, en français, pour la personne qui la lit.
var about = map[string]string{
	"account":              "Votre compte : identité, adresse email, rôle, dates de création, de connexion et d'activité, version de la politique de confidentialité acceptée.",
	"sessions":             "Vos sessions ouvertes (application ou site d'administration) : création, dernière utilisation, appareil déclaré.",
	"devices":              "Vos appareils enregistrés pour les notifications push (le token est tronqué : il suffit à vous envoyer des notifications).",
	"notificationSettings": "Les types de notifications que vous avez désactivés.",
	"notifications":        "Votre boîte de réception (30 derniers jours).",
	"favorites":            "Vos stations favorites et vos alertes « de retour en stock ».",
	"backInStockAlerts":    "Le journal des alertes « de retour en stock » envoyées ou en attente (30 derniers jours).",
	"reports":              "Vos signalements encore rattachés à votre compte (au-delà de 90 jours, ils sont pseudonymisés).",
	"dataRequests":         "Vos demandes d'exercice de vos droits et leurs réponses.",
	"auditTrail":           "Les actions de votre compte au journal de sécurité (connexions, changements de mot de passe, demandes…), 12 derniers mois.",
	"station":              "Gérant : votre station, ses horaires, fermetures, stocks, demandes de déplacement et l'historique des stocks que vous avez saisis.",
	"stationDocument":      "Gérant : le justificatif fourni à l'inscription (IFU, RCCM), encodé en base64.",
	"notCollected":         "Ce que GoStation ne conserve pas, et donc ne peut pas vous fournir.",
}

var notCollected = []string{
	"Votre position : utilisée le temps d'une recherche, d'un itinéraire ou d'un signalement, jamais enregistrée.",
	"Vos recherches : seules des statistiques anonymes par zone (environ 5 km²) et par heure sont conservées, sans lien avec votre compte.",
	"Votre adresse IP : utilisée seulement, sous forme d'empreinte, par les limites anti-abus (de quelques minutes à une heure), jamais enregistrée dans les journaux.",
}

// collect rassemble la copie : une rubrique par catégorie de l'inventaire (docs/legal).
func (s *Service) collect(ctx context.Context, uid uuid.UUID) ([]byte, error) {
	out := map[string]any{
		"format": ExportFormat, "generatedAt": s.now().Format(time.RFC3339), "about": about, "notCollected": notCollected,
	}
	parts := []struct {
		key string
		run func(context.Context, uuid.UUID) ([]byte, error)
	}{
		{"account", s.Store.CollectProfile},
		{"devices", s.Store.CollectDevices},
		{"notificationSettings", s.Store.CollectNotificationSettings},
		{"notifications", s.Store.CollectNotifications},
		{"favorites", s.Store.CollectFavorites},
		{"backInStockAlerts", s.Store.CollectBackInStockAlerts},
		{"reports", func(ctx context.Context, id uuid.UUID) ([]byte, error) { return s.Store.CollectReports(ctx, &id) }},
		{"dataRequests", func(ctx context.Context, id uuid.UUID) ([]byte, error) { return s.Store.CollectDataRequests(ctx, &id) }},
		{"auditTrail", func(ctx context.Context, id uuid.UUID) ([]byte, error) { return s.Store.CollectAuditTrail(ctx, &id) }},
	}
	for _, p := range parts {
		raw, err := p.run(ctx, uid)
		if err != nil {
			return nil, fmt.Errorf("privacy: collect %s: %w", p.key, err)
		}
		out[p.key] = json.RawMessage(raw)
	}
	station, err := s.Store.CollectManagedStation(ctx, &uid)
	switch {
	case store.IsNotFound(err):
		out["station"] = nil
	case err != nil:
		return nil, fmt.Errorf("privacy: collect station: %w", err)
	default:
		out["station"] = json.RawMessage(station)
	}
	out["stationDocument"] = nil
	if doc, err := s.Store.GetManagedStationDocument(ctx, &uid); err == nil {
		data, err := s.Documents.Open(ctx, document.Stored{
			ObjectKey: *doc.DocumentObjectKey, WrappedKey: doc.DocumentWrappedKey, SHA256: doc.DocumentSha256, MIME: deref(doc.DocumentMime),
		})
		if err != nil {
			return nil, fmt.Errorf("privacy: collect document: %w", err)
		}
		out["stationDocument"] = map[string]any{"mimeType": deref(doc.DocumentMime), "contentBase64": base64.StdEncoding.EncodeToString(data)}
	} else if !store.IsNotFound(err) {
		return nil, fmt.Errorf("privacy: collect document: %w", err)
	}
	sessions, err := s.Sessions.List(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("privacy: collect sessions: %w", err)
	}
	list := make([]map[string]any, 0, len(sessions))
	for _, se := range sessions {
		list = append(list, map[string]any{
			"client": se.Client, "userAgent": se.UserAgent, "createdAt": se.CreatedAt.UTC(), "lastUsedAt": se.LastUsedAt.UTC(),
		})
	}
	out["sessions"] = list
	return json.MarshalIndent(out, "", "  ")
}
