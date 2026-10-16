package privacy

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/pagination"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// Types de demandes ouverts au formulaire de l'app (la copie des données a son propre bouton).
var userRequestTypes = map[string]bool{"access": true, "rectification": true, "opposition": true, "deletion": true, "other": true}

// Request est une demande vue par la personne.
type Request struct {
	ID          uuid.UUID
	Reference   string
	Type        string
	Status      string
	Source      string
	DueAt       time.Time
	CreatedAt   time.Time
	CompletedAt *time.Time
	Response    *string
}

// AdminRequest est une demande vue par l'admin (détail).
type AdminRequest struct {
	Request
	Details     *string
	VerifiedAt  *time.Time
	UpdatedAt   time.Time
	Version     int32
	Overdue     bool
	DueSoon     bool
	User        *RequestUser
	HandledBy   *string
	CanVerify   bool
	CanExport   bool
	CanDelete   bool
	CanClose    bool
	CodePending bool
}

// RequestUser est le compte visé par une demande (absent si le compte a été effacé de la base).
type RequestUser struct {
	ID        uuid.UUID
	Email     string
	FirstName string
	LastName  string
	Role      string
	Deleted   bool
}

func open(status dbgen.DataRequestStatus) bool {
	return status == dbgen.DataRequestStatusPending || status == dbgen.DataRequestStatusInProgress
}

// CreateRequest enregistre une demande faite depuis l'app (authentifiée : vérifiée d'office) et en
// accuse réception par email.
func (s *Service) CreateRequest(ctx context.Context, a Actor, kind, details string) (Request, error) {
	details = strings.TrimSpace(details)
	var fe []apperr.FieldError
	if !userRequestTypes[kind] {
		fe = append(fe, field("type", "invalid", "must be access, rectification, opposition, deletion or other"))
	}
	if len([]rune(details)) > maxDetails {
		fe = append(fe, field("details", "too_long", fmt.Sprintf("at most %d characters", maxDetails)))
	}
	if (kind == "rectification" || kind == "other") && len([]rune(details)) < 10 {
		fe = append(fe, field("details", "required", "describe your request (10 characters at least)"))
	}
	if len(fe) > 0 {
		return Request{}, apperr.Validation(fe...)
	}
	if a.Role == string(dbgen.UserRoleAdmin) {
		return Request{}, conflict(CodeAdminAccount, "Admin accounts are handled with the admin CLI.")
	}
	mine, err := s.Store.ListUserDataRequests(ctx, &a.UserID)
	if err != nil {
		return Request{}, fmt.Errorf("privacy: list requests: %w", err)
	}
	n := 0
	for _, r := range mine {
		if open(r.Status) {
			n++
		}
	}
	if n >= MaxOpenPerUser {
		return Request{}, conflict(CodeTooManyOpen, "You already have several requests in progress.")
	}
	now := s.now()
	due := now.Add(s.cfg.RequestDeadline)
	id, err := s.Store.InsertDataRequest(ctx, dbgen.InsertDataRequestParams{
		UserID: &a.UserID, Type: dbgen.DataRequestType(kind), Status: dbgen.DataRequestStatusPending,
		Source: dbgen.DataRequestSourceApp, Details: nilIfEmpty(details), DueAt: due, VerifiedAt: &now,
	})
	if err != nil {
		return Request{}, fmt.Errorf("privacy: create request: %w", err)
	}
	s.Audit.Log(ctx, a.entry(audit.ActionDataRequestCreated, "data_request", id.String(),
		map[string]any{"type": kind, "source": "app"}))
	if u, err := s.Store.GetUserContact(ctx, a.UserID); err == nil {
		m, err := s.Templates.DataRequestReceived(u.Email, u.FirstName, kind, Reference(id), due, s.cfg.ContactEmail)
		s.sendMail(ctx, "data_request_received", m, err)
	}
	return Request{
		ID: id, Reference: Reference(id), Type: kind, Status: string(dbgen.DataRequestStatusPending),
		Source: string(dbgen.DataRequestSourceApp), DueAt: due, CreatedAt: now,
	}, nil
}

// MyRequests liste les demandes de la personne (50 dernières).
func (s *Service) MyRequests(ctx context.Context, a Actor) ([]Request, error) {
	rows, err := s.Store.ListUserDataRequests(ctx, &a.UserID)
	if err != nil {
		return nil, fmt.Errorf("privacy: list requests: %w", err)
	}
	out := make([]Request, 0, len(rows))
	for _, r := range rows {
		out = append(out, Request{
			ID: r.ID, Reference: Reference(r.ID), Type: string(r.Type), Status: string(r.Status), Source: string(r.Source),
			DueAt: r.DueAt, CreatedAt: r.CreatedAt, CompletedAt: r.CompletedAt, Response: r.ResponseNote,
		})
	}
	return out, nil
}

// RecordEmailRequest enregistre une demande reçue par email (admin) : le compte visé reçoit à son
// adresse un code, que la personne communique à l'équipe ; rien n'est traité avant (Verify).
func (s *Service) RecordEmailRequest(ctx context.Context, admin Actor, email, kind, details string) (AdminRequest, error) {
	email, details = strings.TrimSpace(email), strings.TrimSpace(details)
	var fe []apperr.FieldError
	if email == "" || !strings.Contains(email, "@") {
		fe = append(fe, field("email", "invalid", "must be the email address of the account"))
	}
	if !dbgen.DataRequestType(kind).Valid() {
		fe = append(fe, field("type", "invalid", "must be access, export, rectification, opposition, deletion or other"))
	}
	if len([]rune(details)) > maxDetails {
		fe = append(fe, field("details", "too_long", fmt.Sprintf("at most %d characters", maxDetails)))
	}
	if len(fe) > 0 {
		return AdminRequest{}, apperr.Validation(fe...)
	}
	u, err := s.Store.FindUserForDataRequest(ctx, email)
	if store.IsNotFound(err) {
		return AdminRequest{}, apperr.New(http.StatusNotFound, CodeAccountNotFound, "No account uses this email address.")
	}
	if err != nil {
		return AdminRequest{}, fmt.Errorf("privacy: find account: %w", err)
	}
	if u.Role == dbgen.UserRoleAdmin {
		return AdminRequest{}, conflict(CodeAdminAccount, "Admin accounts are handled with the admin CLI.")
	}
	now := s.now()
	id, err := s.Store.InsertDataRequest(ctx, dbgen.InsertDataRequestParams{
		UserID: &u.ID, Type: dbgen.DataRequestType(kind), Status: dbgen.DataRequestStatusPending,
		Source: dbgen.DataRequestSourceEmail, Details: nilIfEmpty(details), DueAt: now.Add(s.cfg.RequestDeadline),
	})
	if err != nil {
		return AdminRequest{}, fmt.Errorf("privacy: create request: %w", err)
	}
	s.Audit.Log(ctx, admin.entry(audit.ActionDataRequestCreated, "data_request", id.String(),
		map[string]any{"type": kind, "source": "email"}))
	if err := s.sendCode(ctx, admin, id, kind, u.Email, u.FirstName); err != nil {
		return AdminRequest{}, err
	}
	return s.Get(ctx, id)
}

// ResendCode envoie un nouveau code de confirmation (l'ancien ne vaut plus).
func (s *Service) ResendCode(ctx context.Context, admin Actor, id uuid.UUID) (AdminRequest, error) {
	r, err := s.load(ctx, id)
	if err != nil {
		return AdminRequest{}, err
	}
	if !open(r.Status) {
		return AdminRequest{}, conflict(CodeClosed, "This request is closed.")
	}
	if r.VerifiedAt != nil {
		return AdminRequest{}, conflict(CodeAlreadyVerified, "This request is already confirmed.")
	}
	if r.UserEmail == nil || r.UserStatus == nil || *r.UserStatus == dbgen.UserStatusPendingDeletion {
		return AdminRequest{}, conflict(CodeAccountDeleted, "The account of this request was deleted.")
	}
	if err := s.sendCode(ctx, admin, id, string(r.Type), *r.UserEmail, deref(r.UserFirstName)); err != nil {
		return AdminRequest{}, err
	}
	return s.Get(ctx, id)
}

// Verify confirme l'identité de la personne (code reçu à l'adresse du compte) et accuse réception.
func (s *Service) Verify(ctx context.Context, admin Actor, id uuid.UUID, version int32, code string) (AdminRequest, error) {
	r, err := s.load(ctx, id)
	if err != nil {
		return AdminRequest{}, err
	}
	if !open(r.Status) {
		return AdminRequest{}, conflict(CodeClosed, "This request is closed.")
	}
	if r.VerifiedAt != nil {
		return AdminRequest{}, conflict(CodeAlreadyVerified, "This request is already confirmed.")
	}
	if err := s.checkCode(ctx, id, strings.TrimSpace(code)); err != nil {
		return AdminRequest{}, err
	}
	n, err := s.Store.VerifyDataRequest(ctx, dbgen.VerifyDataRequestParams{ID: id, Version: version, Now: ptr(s.now())})
	if err != nil {
		return AdminRequest{}, fmt.Errorf("privacy: verify: %w", err)
	}
	if n == 0 {
		return AdminRequest{}, versionConflict()
	}
	s.Audit.Log(ctx, admin.entry(audit.ActionDataRequestVerified, "data_request", id.String(), nil))
	if r.UserEmail != nil {
		m, err := s.Templates.DataRequestReceived(*r.UserEmail, deref(r.UserFirstName), string(r.Type), Reference(id), r.DueAt, s.cfg.ContactEmail)
		s.sendMail(ctx, "data_request_received", m, err)
	}
	return s.Get(ctx, id)
}

// Start marque la demande prise en charge par l'admin.
func (s *Service) Start(ctx context.Context, admin Actor, id uuid.UUID, version int32) (AdminRequest, error) {
	r, err := s.load(ctx, id)
	if err != nil {
		return AdminRequest{}, err
	}
	if err := s.ready(r); err != nil {
		return AdminRequest{}, err
	}
	if err := s.markInProgress(ctx, admin, id, version); err != nil {
		return AdminRequest{}, err
	}
	s.Audit.Log(ctx, admin.entry(audit.ActionDataRequestStarted, "data_request", id.String(), nil))
	return s.Get(ctx, id)
}

// Close clôt la demande avec une réponse (traitée) ou un motif (refusée), transmis par email.
func (s *Service) Close(ctx context.Context, admin Actor, id uuid.UUID, version int32, outcome, response string) (AdminRequest, error) {
	response = strings.TrimSpace(response)
	var fe []apperr.FieldError
	if outcome != string(dbgen.DataRequestStatusCompleted) && outcome != string(dbgen.DataRequestStatusRejected) {
		fe = append(fe, field("outcome", "invalid", "must be completed or rejected"))
	}
	if n := len([]rune(response)); n < 3 || n > maxDetails {
		fe = append(fe, field("response", "invalid", fmt.Sprintf("between 3 and %d characters", maxDetails)))
	}
	if len(fe) > 0 {
		return AdminRequest{}, apperr.Validation(fe...)
	}
	r, err := s.load(ctx, id)
	if err != nil {
		return AdminRequest{}, err
	}
	if !open(r.Status) {
		return AdminRequest{}, conflict(CodeClosed, "This request is already closed.")
	}
	if err := s.close(ctx, admin, id, &version, dbgen.DataRequestStatus(outcome), response); err != nil {
		return AdminRequest{}, err
	}
	if r.UserEmail != nil && r.UserStatus != nil && *r.UserStatus != dbgen.UserStatusPendingDeletion {
		m, err := s.Templates.DataRequestClosed(*r.UserEmail, deref(r.UserFirstName), string(r.Type), Reference(id),
			outcome == string(dbgen.DataRequestStatusCompleted), response)
		s.sendMail(ctx, "data_request_closed", m, err)
	}
	return s.Get(ctx, id)
}

func (s *Service) close(ctx context.Context, admin Actor, id uuid.UUID, version *int32, status dbgen.DataRequestStatus, response string) error {
	n, err := s.Store.CloseDataRequest(ctx, dbgen.CloseDataRequestParams{
		ID: id, Status: status, ResponseNote: &response, HandledBy: &admin.UserID, Now: ptr(s.now()), Version: version,
	})
	if err != nil {
		return fmt.Errorf("privacy: close: %w", err)
	}
	if n == 0 {
		return versionConflict()
	}
	s.Audit.Log(ctx, admin.entry(audit.ActionDataRequestClosed, "data_request", id.String(), map[string]any{"outcome": string(status)}))
	return nil
}

func (s *Service) markInProgress(ctx context.Context, admin Actor, id uuid.UUID, version int32) error {
	n, err := s.Store.MarkDataRequestInProgress(ctx, dbgen.MarkDataRequestInProgressParams{
		ID: id, Version: version, HandledBy: &admin.UserID, Now: s.now(),
	})
	if err != nil {
		return fmt.Errorf("privacy: start: %w", err)
	}
	if n == 0 {
		return versionConflict()
	}
	return nil
}

// ready vérifie qu'une demande peut être traitée : ouverte et confirmée.
func (s *Service) ready(r dbgen.GetDataRequestRow) error {
	if !open(r.Status) {
		return conflict(CodeClosed, "This request is closed.")
	}
	if r.VerifiedAt == nil {
		return conflict(CodeNotVerified, "Confirm the identity of the person with the code sent to the account first.")
	}
	return nil
}

func (s *Service) load(ctx context.Context, id uuid.UUID) (dbgen.GetDataRequestRow, error) {
	r, err := s.Store.GetDataRequest(ctx, id)
	if err != nil {
		return r, fmt.Errorf("privacy: load request: %w", store.Translate(err))
	}
	return r, nil
}

// Get renvoie le détail d'une demande (admin).
func (s *Service) Get(ctx context.Context, id uuid.UUID) (AdminRequest, error) {
	r, err := s.load(ctx, id)
	if err != nil {
		return AdminRequest{}, err
	}
	now := s.now()
	v := AdminRequest{
		Request: Request{
			ID: r.ID, Reference: Reference(r.ID), Type: string(r.Type), Status: string(r.Status), Source: string(r.Source),
			DueAt: r.DueAt, CreatedAt: r.CreatedAt, CompletedAt: r.CompletedAt, Response: r.ResponseNote,
		},
		Details: r.Details, VerifiedAt: r.VerifiedAt, UpdatedAt: r.UpdatedAt, Version: r.Version,
		Overdue: open(r.Status) && r.DueAt.Before(now),
		DueSoon: open(r.Status) && !r.DueAt.Before(now) && r.DueAt.Before(now.Add(s.cfg.DueSoon)),
	}
	if r.UserID != nil && r.UserEmail != nil {
		v.User = &RequestUser{
			ID: *r.UserID, Email: *r.UserEmail, FirstName: deref(r.UserFirstName), LastName: deref(r.UserLastName),
			Deleted: r.UserStatus != nil && *r.UserStatus == dbgen.UserStatusPendingDeletion,
		}
		if r.UserRole != nil {
			v.User.Role = string(*r.UserRole)
		}
	}
	if r.HandlerFirstName != nil {
		name := strings.TrimSpace(*r.HandlerFirstName + " " + deref(r.HandlerLastName))
		v.HandledBy = &name
	}
	live := v.User != nil && !v.User.Deleted
	isOpen := open(r.Status)
	v.CanVerify = isOpen && r.VerifiedAt == nil && live
	v.CanExport = isOpen && r.VerifiedAt != nil && live
	v.CanDelete = v.CanExport && r.Type == dbgen.DataRequestTypeDeletion
	v.CanClose = isOpen
	if v.CanVerify {
		v.CodePending, _ = s.hasCode(ctx, id)
	}
	return v, nil
}

// AdminFilter filtre la liste admin.
type AdminFilter struct {
	Type    string
	Status  string // pending, in_progress, completed, rejected ou open (reçues et en cours)
	Overdue bool
	Cursor  string
	Limit   int
}

// AdminListItem est une ligne de la liste admin.
type AdminListItem struct {
	ID          uuid.UUID
	Reference   string
	Type        string
	Status      string
	Source      string
	DueAt       time.Time
	CreatedAt   time.Time
	Verified    bool
	Overdue     bool
	DueSoon     bool
	UserEmail   *string
	UserRole    *string
	CompletedAt *time.Time
}

// AdminPage est une page de la liste admin.
type AdminPage struct {
	Items      []AdminListItem
	NextCursor string
}

// List liste les demandes, les plus récentes d'abord.
func (s *Service) List(ctx context.Context, f AdminFilter) (AdminPage, error) {
	n, err := pagination.Limit(f.Limit)
	if err != nil {
		return AdminPage{}, err
	}
	now := s.now()
	p := dbgen.ListDataRequestsParams{OverdueOnly: f.Overdue, Now: now, PageSize: int32(n + 1)} //nolint:gosec // ≤ 101
	var fe []apperr.FieldError
	if f.Type != "" {
		t := dbgen.DataRequestType(f.Type)
		if !t.Valid() {
			fe = append(fe, field("type", "invalid", "must be access, export, rectification, deletion, opposition or other"))
		}
		p.Type = &t
	}
	switch f.Status {
	case "":
	case "open":
		p.OpenOnly = true
	default:
		st := dbgen.DataRequestStatus(f.Status)
		if !st.Valid() {
			fe = append(fe, field("status", "invalid", "must be open, pending, in_progress, completed or rejected"))
		}
		p.Status = &st
	}
	if len(fe) > 0 {
		return AdminPage{}, apperr.Validation(fe...)
	}
	if f.Cursor != "" {
		at, id, err := pagination.Decode(f.Cursor)
		if err != nil {
			return AdminPage{}, err
		}
		uid, err := uuid.Parse(id)
		if err != nil {
			return AdminPage{}, apperr.BadRequest(apperr.CodeInvalidParameter, "Invalid cursor.")
		}
		p.CursorAt, p.CursorID = &at, &uid
	}
	rows, err := s.Store.ListDataRequests(ctx, p)
	if err != nil {
		return AdminPage{}, fmt.Errorf("privacy: list: %w", err)
	}
	page := AdminPage{Items: make([]AdminListItem, 0, min(len(rows), n))}
	for i, r := range rows {
		if i == n {
			last := rows[n-1]
			page.NextCursor = pagination.Encode(last.CreatedAt, last.ID.String())
			break
		}
		it := AdminListItem{
			ID: r.ID, Reference: Reference(r.ID), Type: string(r.Type), Status: string(r.Status), Source: string(r.Source),
			DueAt: r.DueAt, CreatedAt: r.CreatedAt, Verified: r.VerifiedAt != nil, UserEmail: r.UserEmail,
			Overdue: open(r.Status) && r.DueAt.Before(now), CompletedAt: r.CompletedAt,
			DueSoon: open(r.Status) && !r.DueAt.Before(now) && r.DueAt.Before(now.Add(s.cfg.DueSoon)),
		}
		if r.UserRole != nil {
			it.UserRole = ptr(string(*r.UserRole))
		}
		page.Items = append(page.Items, it)
	}
	return page, nil
}

// Counters compte les demandes ouvertes, à échéance proche et échues (badge et alerte admin).
type Counters struct {
	Open    int
	DueSoon int
	Overdue int
}

// Counters renvoie les compteurs de la barre latérale admin.
func (s *Service) Counters(ctx context.Context) (Counters, error) {
	now := s.now()
	r, err := s.Store.DataRequestCounters(ctx, dbgen.DataRequestCountersParams{Now: now, Soon: now.Add(s.cfg.DueSoon)})
	if err != nil {
		return Counters{}, fmt.Errorf("privacy: counters: %w", err)
	}
	return Counters{Open: int(r.Open), DueSoon: int(r.DueSoon), Overdue: int(r.Overdue)}, nil
}

// --- Codes de confirmation (demandes reçues par email) --------------------------------------

func codeKey(id uuid.UUID) string     { return "privacy:code:" + id.String() }
func attemptsKey(id uuid.UUID) string { return "privacy:code:attempts:" + id.String() }

func (s *Service) codeHash(id uuid.UUID, code string) string {
	m := hmac.New(sha256.New, s.CodeKey)
	m.Write([]byte(id.String() + "|" + code))
	return hex.EncodeToString(m.Sum(nil))
}

// sendCode tire un code à 6 chiffres (seule son empreinte HMAC est gardée, 7 jours) et l'envoie à
// l'adresse du compte.
func (s *Service) sendCode(ctx context.Context, admin Actor, id uuid.UUID, kind, email, firstName string) error {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return fmt.Errorf("privacy: code: %w", err)
	}
	code := fmt.Sprintf("%06d", n.Int64())
	pipe := s.Redis.TxPipeline()
	pipe.Set(ctx, codeKey(id), s.codeHash(id, code), CodeTTL)
	pipe.Del(ctx, attemptsKey(id))
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("privacy: store code: %w", err)
	}
	m, err := s.Templates.DataRequestCode(email, firstName, kind, Reference(id), code, CodeTTL, s.cfg.ContactEmail)
	if err != nil {
		return fmt.Errorf("privacy: render code email: %w", err)
	}
	if err := s.Mailer.Send(ctx, m); err != nil {
		return fmt.Errorf("privacy: send code: %w", err)
	}
	s.Audit.Log(ctx, admin.entry(audit.ActionDataRequestCodeSent, "data_request", id.String(), nil))
	return nil
}

func (s *Service) hasCode(ctx context.Context, id uuid.UUID) (bool, error) {
	n, err := s.Redis.Exists(ctx, codeKey(id)).Result()
	return n == 1, err
}

// checkCode compare le code (5 essais, puis le code ne vaut plus : il faut en renvoyer un).
func (s *Service) checkCode(ctx context.Context, id uuid.UUID, code string) error {
	invalid := apperr.BadRequest(CodeInvalidCode, "Invalid or expired code: send a new one if needed.")
	tries, err := s.Redis.Incr(ctx, attemptsKey(id)).Result()
	if err != nil {
		return fmt.Errorf("privacy: code attempts: %w", err)
	}
	s.Redis.Expire(ctx, attemptsKey(id), CodeTTL)
	if tries > CodeAttempts {
		s.Redis.Del(ctx, codeKey(id))
		return invalid
	}
	want, err := s.Redis.Get(ctx, codeKey(id)).Result()
	if errors.Is(err, goredis.Nil) {
		return invalid
	}
	if err != nil {
		return fmt.Errorf("privacy: load code: %w", err)
	}
	if !hmac.Equal([]byte(want), []byte(s.codeHash(id, code))) {
		return invalid
	}
	s.Redis.Del(ctx, codeKey(id), attemptsKey(id))
	return nil
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
