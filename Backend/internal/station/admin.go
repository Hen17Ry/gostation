package station

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/notification"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// AdminFilter filtre la liste admin des stations.
type AdminFilter struct {
	Status          string // pending (défaut côté handler), approved, rejected, suspended ; "all" = tous
	Query           string
	NeedsReview     bool   // épingle signalée ou demande de déplacement en attente
	Freshness       string // stale (8 à 24 h) | expired (plus de 24 h ou jamais) ; vide = indifférent
	ManagerInactive bool   // alerte « gérant inactif » ouverte
	NoHours         bool   // aucun horaire
	Reported        bool   // effet de signalement en cours (badge ou exclusion)
	Excluded        bool   // seuil de 5 signalements atteint (produit ou station exclus de la recherche)
	Cursor          string
	Limit           int
}

// AdminPage est une page de la liste admin.
type AdminPage struct {
	Items      []dbgen.ListStationsForAdminRow
	NextCursor string
}

func encodeCursor(t time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(t.UTC().Format(time.RFC3339Nano) + "|" + id.String()))
}

func decodeCursor(c string) (time.Time, uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	ts, id, ok := strings.Cut(string(raw), "|")
	if !ok {
		return time.Time{}, uuid.Nil, fmt.Errorf("malformed cursor")
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	u, err := uuid.Parse(id)
	return t, u, err
}

// likeEscaper protège les jokers de LIKE dans la recherche par nom ou IFU.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// AdminList liste les stations, les plus récentes d'abord. Un dossier pending n'y figure qu'une
// fois l'email du gérant vérifié (D5).
func (s *Service) AdminList(ctx context.Context, f AdminFilter) (AdminPage, error) {
	var fe fieldErrors
	p := dbgen.ListStationsForAdminParams{
		NeedsReview: f.NeedsReview, ManagerInactive: f.ManagerInactive, NoHours: f.NoHours, Reported: f.Reported, Excluded: f.Excluded,
	}
	switch f.Status {
	case "all":
	case StatusPending, StatusApproved, StatusRejected, StatusSuspended:
		st := dbgen.StationStatus(f.Status)
		p.Status = &st
	default:
		fe.add("status", "invalid", "must be pending, approved, rejected, suspended or all")
	}
	switch f.Freshness {
	case "":
	case FreshnessStale, FreshnessExpired:
		p.Freshness = &f.Freshness
	default:
		fe.add("freshness", "invalid", "must be stale or expired")
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		fe.add("limit", "out_of_range", "must be between 1 and 100")
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		if len([]rune(q)) > 100 {
			fe.add("q", "too_long", "must be at most 100 characters")
		}
		escaped := likeEscaper.Replace(q)
		p.Query = &escaped
	}
	if err := fe.err(); err != nil {
		return AdminPage{}, err
	}
	now := s.now()
	p.StaleSince, p.ExpiredSince = now.Add(-s.cfg.StaleAfter), now.Add(-s.cfg.ExpiredAfter)
	p.PageSize = int32(limit + 1) //nolint:gosec // ≤ 101
	if f.Cursor != "" {
		t, id, err := decodeCursor(f.Cursor)
		if err != nil {
			return AdminPage{}, apperr.BadRequest(apperr.CodeInvalidParameter, "Invalid cursor.")
		}
		p.CursorCreatedAt, p.CursorID = &t, &id
	}
	rows, err := s.Store.ListStationsForAdmin(ctx, p)
	if err != nil {
		return AdminPage{}, fmt.Errorf("station: admin list: %w", err)
	}
	page := AdminPage{Items: rows}
	if len(rows) > limit {
		page.Items = rows[:limit]
		last := page.Items[limit-1]
		page.NextCursor = encodeCursor(last.CreatedAt, last.ID)
	}
	return page, nil
}

// StationFreshness classe la dernière saisie ou confirmation d'une station : fresh, stale,
// expired, ou none si le gérant n'a jamais saisi ses stocks.
func (s *Service) StationFreshness(last *time.Time) string {
	if last == nil {
		return "none"
	}
	return s.Freshness(*last)
}

// MapStation est une station de la carte admin.
type MapStation struct {
	dbgen.ListStationsForMapRow
	Freshness string
}

// Map renvoie toutes les stations épinglées (d'un statut, ou toutes) pour la carte admin.
func (s *Service) Map(ctx context.Context, status string) ([]MapStation, error) {
	var p *dbgen.StationStatus
	switch status {
	case "", "all":
	case StatusPending, StatusApproved, StatusRejected, StatusSuspended:
		st := dbgen.StationStatus(status)
		p = &st
	default:
		return nil, apperr.Validation(apperr.FieldError{Field: "status", Code: "invalid", Message: "must be pending, approved, rejected, suspended or all"})
	}
	rows, err := s.Store.ListStationsForMap(ctx, p)
	if err != nil {
		return nil, fmt.Errorf("station: map: %w", err)
	}
	out := make([]MapStation, 0, len(rows))
	for _, r := range rows {
		out = append(out, MapStation{ListStationsForMapRow: r, Freshness: s.StationFreshness(r.LastStockUpdateAt)})
	}
	return out, nil
}

// ensureStation renvoie 404 si la station n'existe pas (avant le contrôle de version, qui
// répondrait sinon 412).
func ensureStation(ctx context.Context, q *dbgen.Queries, id uuid.UUID) error {
	if _, err := q.GetStationDocument(ctx, id); err != nil {
		return fmt.Errorf("station: load station: %w", store.Translate(err))
	}
	return nil
}

// AdminStation est la vue admin détaillée d'une station.
type AdminStation struct {
	dbgen.GetStationForAdminRow
	PendingMove *LocationRequest
	// Horaires (fermetures à venir comprises) et stocks des produits vendus : fiche admin complète.
	Hours  HoursView
	Stocks []StockItem
}

// AdminDetail renvoie le détail d'une station.
func (s *Service) AdminDetail(ctx context.Context, stationID uuid.UUID) (AdminStation, error) {
	row, err := s.Store.GetStationForAdmin(ctx, stationID)
	if err != nil {
		return AdminStation{}, fmt.Errorf("station: admin detail: %w", store.Translate(err))
	}
	move, err := s.pendingMove(ctx, s.Store.Queries, stationID)
	if err != nil {
		return AdminStation{}, err
	}
	hours, err := s.hoursFor(ctx, s.Store.Queries, stationID, row.Version)
	if err != nil {
		return AdminStation{}, err
	}
	stocks, err := s.stockItems(ctx, stationID)
	if err != nil {
		return AdminStation{}, err
	}
	return AdminStation{GetStationForAdminRow: row, PendingMove: move, Hours: hours, Stocks: stocks}, nil
}

// transition décrit une décision admin sur le statut.
type transition struct {
	action   string // verbe des messages d'erreur
	from     string
	to       dbgen.StationStatus
	email    mail.StationStatusChange
	push     string // décision envoyée au gérant (push et boîte de réception)
	audit    string
	reasonOK bool // motif obligatoire
}

var transitions = map[string]transition{
	"approve":   {"approve", StatusPending, dbgen.StationStatusApproved, mail.StationApproved, notification.DecisionApproved, audit.ActionStationApproved, false},
	"reject":    {"reject", StatusPending, dbgen.StationStatusRejected, mail.StationRejected, notification.DecisionRejected, audit.ActionStationRejected, true},
	"suspend":   {"suspend", StatusApproved, dbgen.StationStatusSuspended, mail.StationSuspended, notification.DecisionSuspended, audit.ActionStationSuspended, true},
	"unsuspend": {"unsuspend", StatusSuspended, dbgen.StationStatusApproved, mail.StationReinstated, notification.DecisionReinstated, audit.ActionStationUnsuspended, true},
}

// ChangeStatus applique une décision admin (approve, reject, suspend, unsuspend) : transition
// autorisée, motif obligatoire sauf pour approve, email au gérant, audit, invalidation du cache.
func (s *Service) ChangeStatus(ctx context.Context, admin Actor, stationID uuid.UUID, expected int32, decision, reason string) (AdminStation, error) {
	tr, ok := transitions[decision]
	if !ok {
		return AdminStation{}, fmt.Errorf("station: unknown decision %q", decision)
	}
	var reasonPtr *string
	if tr.reasonOK {
		r, err := requireReason(reason)
		if err != nil {
			return AdminStation{}, err
		}
		reasonPtr = &r
	}
	var contact dbgen.GetStationContactRow
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		var err error
		contact, err = q.GetStationContact(ctx, stationID)
		if err != nil {
			return fmt.Errorf("station: load station: %w", store.Translate(err))
		}
		if _, err := bump(ctx, q, stationID, expected); err != nil {
			return err
		}
		if string(contact.Status) != tr.from {
			return errTransition(string(contact.Status), tr.action)
		}
		if decision == "approve" && contact.EmailVerifiedAt == nil {
			return apperr.New(http.StatusConflict, CodeManagerEmailUnverified, "The manager has not verified their email address yet.")
		}
		return q.SetStationStatus(ctx, dbgen.SetStationStatusParams{ID: stationID, Status: tr.to, Reason: reasonPtr, ReviewedBy: &admin.UserID})
	})
	if err != nil {
		return AdminStation{}, err
	}
	meta := map[string]any{"from": tr.from, "to": string(tr.to)}
	if reasonPtr != nil {
		meta["reason"] = *reasonPtr
	}
	s.audit(ctx, admin, tr.audit, stationID, meta)
	s.invalidate(ctx, true)
	s.notify(ctx, stationID, tr.email, reason)
	s.pushDecision(ctx, stationID, tr.push)
	return s.AdminDetail(ctx, stationID)
}

// ResolveMove valide ou refuse la demande de déplacement en attente (motif obligatoire pour un
// refus). Validée, la nouvelle position et sa cellule H3 remplacent l'ancienne.
func (s *Service) ResolveMove(ctx context.Context, admin Actor, stationID, requestID uuid.UUID, expected int32, approve bool, reason string) (AdminStation, error) {
	var reasonPtr *string
	if !approve {
		r, err := requireReason(reason)
		if err != nil {
			return AdminStation{}, err
		}
		reasonPtr = &r
	}
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := ensureStation(ctx, q, stationID); err != nil {
			return err
		}
		if _, err := bump(ctx, q, stationID, expected); err != nil {
			return err
		}
		if approve {
			if n, err := q.ApplyLocationRequest(ctx, requestID); err != nil {
				return fmt.Errorf("station: apply move: %w", err)
			} else if n == 0 {
				return apperr.NotFound("No pending location request with this id.")
			}
			if err := locationChanged(ctx, q, stationID); err != nil {
				return err
			}
		}
		status := dbgen.LocationRequestStatusRejected
		if approve {
			status = dbgen.LocationRequestStatusApproved
		}
		n, err := q.ResolveLocationRequest(ctx, dbgen.ResolveLocationRequestParams{
			ID: requestID, StationID: stationID, Status: status, Reason: reasonPtr, ReviewedBy: &admin.UserID,
		})
		if err != nil {
			return fmt.Errorf("station: resolve move: %w", err)
		}
		if n == 0 {
			return apperr.NotFound("No pending location request with this id.")
		}
		return nil
	})
	if err != nil {
		return AdminStation{}, err
	}
	action, meta := audit.ActionLocationRequestRejected, map[string]any{"requestId": requestID.String()}
	change := mail.StationMoveRejected
	if approve {
		action, change = audit.ActionLocationRequestApproved, mail.StationMoveApproved
		s.invalidate(ctx, true)
		reason = ""
	} else {
		meta["reason"] = *reasonPtr
		reason = *reasonPtr
	}
	s.audit(ctx, admin, action, stationID, meta)
	s.notify(ctx, stationID, change, reason)
	decision := notification.DecisionMoveRejected
	if approve {
		decision = notification.DecisionMoveApproved
	}
	s.pushDecision(ctx, stationID, decision)
	return s.AdminDetail(ctx, stationID)
}

// DismissLocationFlag lève le signalement d'une épingle éloignée de l'appareil du gérant.
func (s *Service) DismissLocationFlag(ctx context.Context, admin Actor, stationID uuid.UUID, expected int32) (AdminStation, error) {
	err := s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if err := ensureStation(ctx, q, stationID); err != nil {
			return err
		}
		if _, err := bump(ctx, q, stationID, expected); err != nil {
			return err
		}
		return q.ClearStationLocationFlag(ctx, stationID)
	})
	if err != nil {
		return AdminStation{}, err
	}
	s.audit(ctx, admin, audit.ActionLocationFlagDismissed, stationID, nil)
	return s.AdminDetail(ctx, stationID)
}

// Libellés français des champs corrigés (email au gérant).
var fieldLabels = map[string]string{
	"name": "nom", "brand": "marque", "address": "adresse", "city": "ville",
	"phone": "téléphone", "ifu": "IFU", "rccm": "RCCM",
}

// profileFields renvoie les champs du profil d'une station, dans l'ordre d'affichage.
func profileFields(st dbgen.GetStationForAdminRow) [][2]string {
	return [][2]string{
		{"name", st.Name},
		{"brand", deref(st.Brand)},
		{"address", st.Address},
		{"city", deref(st.City)},
		{"phone", st.Phone},
		{"ifu", st.Ifu},
		{"rccm", st.Rccm},
	}
}

func deref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// AdminUpdate corrige les informations d'une station (nom, marque, adresse, ville, téléphone, IFU,
// RCCM), avec un motif obligatoire. Le statut ne change pas : l'admin est le valideur (un IFU ou un
// RCCM corrigé par lui ne renvoie pas en pending). Audit avant/après, email au gérant, invalidation
// du cache (le nom et la marque figurent dans les résultats). Les stocks ne sont jamais modifiables
// par l'admin.
func (s *Service) AdminUpdate(ctx context.Context, admin Actor, stationID uuid.UUID, expected int32, in ProfileInput, reason string) (AdminStation, error) {
	params, err := validateProfile(in)
	r, rerr := requireReason(reason)
	if err != nil || rerr != nil {
		var fe fieldErrors
		var ae *apperr.Error
		for _, e := range []error{err, rerr} {
			if errors.As(e, &ae) {
				fe = append(fe, ae.Fields...)
			}
		}
		return AdminStation{}, fe.err()
	}
	if len(changedFields(in)) == 0 {
		return AdminStation{}, apperr.Validation(apperr.FieldError{Field: "name", Code: "required", Message: "at least one field must be provided"})
	}
	var before dbgen.GetStationForAdminRow
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		if before, err = q.GetStationForAdmin(ctx, stationID); err != nil {
			return fmt.Errorf("station: load station: %w", store.Translate(err))
		}
		if _, err := bump(ctx, q, stationID, expected); err != nil {
			return err
		}
		params.ID = stationID
		if err := q.UpdateStationProfile(ctx, params); err != nil {
			return fmt.Errorf("station: admin update: %w", err)
		}
		return nil
	})
	if err != nil {
		return AdminStation{}, err
	}
	after, err := s.AdminDetail(ctx, stationID)
	if err != nil {
		return AdminStation{}, err
	}
	changes := map[string]any{}
	var labels []string
	old := profileFields(before)
	for i, f := range profileFields(after.GetStationForAdminRow) {
		if f[1] != old[i][1] {
			changes[f[0]] = map[string]string{"from": old[i][1], "to": f[1]}
			labels = append(labels, fieldLabels[f[0]])
		}
	}
	s.audit(ctx, admin, audit.ActionStationCorrected, stationID, map[string]any{"reason": r, "changes": changes})
	if len(changes) > 0 {
		s.invalidate(ctx, true)
		s.notifyCorrection(ctx, stationID, labels, r)
	}
	return after, nil
}

// notifyCorrection prévient le gérant d'une correction de l'admin ; un échec est journalisé.
func (s *Service) notifyCorrection(ctx context.Context, stationID uuid.UUID, fields []string, reason string) {
	contact, err := s.Store.GetStationContact(ctx, stationID)
	if store.IsNotFound(err) {
		return // station sans gérant (données fictives)
	}
	if err == nil {
		var m mail.Message
		if m, err = s.Templates.StationCorrected(contact.Email, contact.FirstName, contact.Name, fields, reason); err == nil {
			err = s.Mailer.Send(ctx, m)
		}
	}
	if err != nil {
		s.Log.ErrorContext(ctx, "station: correction email", slog.Any("err", err))
	}
}
