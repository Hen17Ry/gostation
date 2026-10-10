package station

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/document"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/store/dbgen"
)

// ProfileInput est une modification partielle du profil : nil = inchangé. Pour Brand et City,
// une chaîne vide efface la valeur.
type ProfileInput struct {
	Name    *string
	Brand   *string
	Address *string
	City    *string
	Phone   *string
	IFU     *string
	RCCM    *string
}

var (
	ifuPattern   = regexp.MustCompile(`^[0-9]{13}$`)
	rccmPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 /.\-]{3,48}[A-Za-z0-9]$`)
	phonePattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)
	phoneNoise   = strings.NewReplacer(" ", "", ".", "", "-", "", "(", "", ")", "")
)

type fieldErrors []apperr.FieldError

func (f *fieldErrors) add(field, code, msg string) {
	*f = append(*f, apperr.FieldError{Field: field, Code: code, Message: msg})
}

func (f fieldErrors) err() error {
	if len(f) == 0 {
		return nil
	}
	return apperr.Validation(f...)
}

func (f *fieldErrors) text(field string, v *string, minLen, maxLen int) *string {
	if v == nil {
		return nil
	}
	t := strings.TrimSpace(*v)
	if n := utf8.RuneCountInString(t); n < minLen || n > maxLen {
		f.add(field, "invalid_length", fmt.Sprintf("must be %d to %d characters", minLen, maxLen))
	}
	return &t
}

// validateProfile normalise la saisie (mêmes règles qu'à l'inscription).
func validateProfile(in ProfileInput) (dbgen.UpdateStationProfileParams, error) {
	var f fieldErrors
	p := dbgen.UpdateStationProfileParams{
		Name:    f.text("name", in.Name, 2, 120),
		Address: f.text("address", in.Address, 5, 255),
	}
	if in.Brand != nil {
		p.SetBrand = true
		if b := f.text("brand", in.Brand, 0, 60); *b != "" {
			p.Brand = b
		}
	}
	if in.City != nil {
		p.SetCity = true
		if c := f.text("city", in.City, 0, 100); *c != "" {
			p.City = c
		}
	}
	if in.Phone != nil {
		v := phoneNoise.Replace(strings.TrimSpace(*in.Phone))
		if !phonePattern.MatchString(v) {
			f.add("phone", "invalid", "must be an international number such as +2290190000000")
		}
		p.Phone = &v
	}
	if in.IFU != nil {
		v := strings.TrimSpace(*in.IFU)
		if !ifuPattern.MatchString(v) {
			f.add("ifu", "invalid", "must be exactly 13 digits")
		}
		p.Ifu = &v
	}
	if in.RCCM != nil {
		v := strings.ToUpper(strings.Join(strings.Fields(*in.RCCM), " "))
		if !rccmPattern.MatchString(v) {
			f.add("rccm", "invalid", "must be a registry number such as RB/COT/24 B 12345")
		}
		p.Rccm = &v
	}
	return p, f.err()
}

// UpdateProfile modifie le profil (D14). Pour une station approuvée, un changement d'IFU ou de
// RCCM la renvoie en pending (elle sort de la recherche jusqu'à une nouvelle validation).
func (s *Service) UpdateProfile(ctx context.Context, a Actor, expected int32, in ProfileInput) (ManagerStation, error) {
	params, err := validateProfile(in)
	if err != nil {
		return ManagerStation{}, err
	}
	var stationID uuid.UUID
	var backToPending bool
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		st, err := s.managerStation(ctx, q, a.UserID)
		if err != nil {
			return err
		}
		stationID = st.ID
		if _, err := bump(ctx, q, st.ID, expected); err != nil {
			return err
		}
		params.ID = st.ID
		if err := q.UpdateStationProfile(ctx, params); err != nil {
			return fmt.Errorf("station: update profile: %w", err)
		}
		identityChanged := (params.Ifu != nil && *params.Ifu != st.Ifu) || (params.Rccm != nil && *params.Rccm != st.Rccm)
		if identityChanged && string(st.Status) == StatusApproved {
			backToPending = true
			if err := q.SetStationStatus(ctx, dbgen.SetStationStatusParams{ID: st.ID, Status: dbgen.StationStatusPending}); err != nil {
				return fmt.Errorf("station: back to pending: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return ManagerStation{}, err
	}
	s.audit(ctx, a, audit.ActionStationUpdated, stationID, map[string]any{"fields": changedFields(in), "backToPending": backToPending})
	if backToPending {
		s.invalidate(ctx, true)
		s.notify(ctx, stationID, mail.StationIdentityChanged, "")
	}
	return s.ForManager(ctx, a.UserID)
}

func changedFields(in ProfileInput) []string {
	var out []string
	for name, v := range map[string]*string{
		"name": in.Name, "brand": in.Brand, "address": in.Address,
		"city": in.City, "phone": in.Phone, "ifu": in.IFU, "rccm": in.RCCM,
	} {
		if v != nil {
			out = append(out, name)
		}
	}
	return out
}

// Resubmit enregistre un nouveau justificatif pour une station rejetée et la renvoie en
// pending (D15). L'ancien justificatif est supprimé après le commit.
func (s *Service) Resubmit(ctx context.Context, a Actor, expected int32, doc io.Reader) (ManagerStation, error) {
	if doc == nil {
		return ManagerStation{}, apperr.Validation(apperr.FieldError{Field: "document", Code: "required", Message: "is required"})
	}
	prepared, err := s.Documents.Prepare(doc)
	if err != nil {
		return ManagerStation{}, err
	}
	var stationID uuid.UUID
	var stored document.Stored
	var oldKey string
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		st, err := s.managerStation(ctx, q, a.UserID)
		if err != nil {
			return err
		}
		stationID = st.ID
		if _, err := bump(ctx, q, st.ID, expected); err != nil {
			return err
		}
		if string(st.Status) != StatusRejected {
			return errTransition(string(st.Status), "resubmit")
		}
		doc, err := q.GetStationDocument(ctx, st.ID)
		if err != nil {
			return fmt.Errorf("station: load document: %w", err)
		}
		if doc.DocumentObjectKey != nil {
			oldKey = *doc.DocumentObjectKey
		}
		if stored, err = s.Documents.Save(ctx, a.UserID, prepared); err != nil {
			return err
		}
		if err := q.ReplaceStationDocument(ctx, dbgen.ReplaceStationDocumentParams{
			ID: st.ID, DocumentObjectKey: &stored.ObjectKey, DocumentWrappedKey: stored.WrappedKey,
			DocumentSha256: stored.SHA256, DocumentMime: &stored.MIME,
		}); err != nil {
			return fmt.Errorf("station: replace document: %w", err)
		}
		return q.SetStationStatus(ctx, dbgen.SetStationStatusParams{ID: st.ID, Status: dbgen.StationStatusPending})
	})
	if err != nil {
		if stored.ObjectKey != "" {
			s.deleteObject(ctx, stored.ObjectKey)
		}
		return ManagerStation{}, err
	}
	if oldKey != "" {
		s.deleteObject(ctx, oldKey)
	}
	s.audit(ctx, a, audit.ActionStationResubmitted, stationID, map[string]any{"documentMime": stored.MIME})
	s.invalidate(ctx, true)
	s.notify(ctx, stationID, mail.StationResubmitted, "")
	return s.ForManager(ctx, a.UserID)
}

func (s *Service) deleteObject(ctx context.Context, key string) {
	if err := s.Documents.Delete(context.WithoutCancel(ctx), key); err != nil {
		s.Log.ErrorContext(ctx, "station: delete document object", slog.Any("err", err))
	}
}

// requireReason valide un motif obligatoire (rejet, suspension, levée de suspension, refus).
func requireReason(reason string) (string, error) {
	r := strings.TrimSpace(reason)
	if n := utf8.RuneCountInString(r); n < 3 || n > 500 {
		return "", apperr.Validation(apperr.FieldError{Field: "reason", Code: "required", Message: "a reason of 3 to 500 characters is required"})
	}
	return r, nil
}
