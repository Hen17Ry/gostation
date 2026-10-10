package auth

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/audit"
	"gostation/backend/internal/document"
	"gostation/backend/internal/store"
	"gostation/backend/internal/store/dbgen"
)

// AccountInput est la partie « compte » d'une inscription.
type AccountInput struct {
	FirstName            string
	LastName             string
	Email                string
	Password             string
	PrivacyPolicyVersion string
}

// StationInput est la partie « station » de l'inscription d'un gérant.
type StationInput struct {
	Name    string
	Brand   string
	IFU     string
	RCCM    string
	Address string
	City    string
	Phone   string
}

// account valide le compte et renvoie les valeurs normalisées.
func (s *Service) validateAccount(v *validator, in AccountInput) AccountInput {
	out := AccountInput{
		FirstName:            v.text("firstName", in.FirstName, 1, 100),
		LastName:             v.text("lastName", in.LastName, 1, 100),
		Email:                v.email("email", in.Email),
		Password:             in.Password,
		PrivacyPolicyVersion: in.PrivacyPolicyVersion,
	}
	if in.PrivacyPolicyVersion != s.cfg.PrivacyPolicyVersion {
		v.add("privacyPolicyVersion", "outdated", "the current privacy policy ("+s.cfg.PrivacyPolicyVersion+") must be accepted")
	}
	return out
}

func (s *Service) checkPassword(v *validator, field, password, email string) {
	if err := s.Policy.Validate(field, password, email); err != nil {
		if e, ok := apperr.As(err); ok {
			v.fields = append(v.fields, e.Fields...)
		}
	}
}

func errEmailTaken() *apperr.Error {
	return apperr.New(http.StatusConflict, CodeEmailTaken, "An account already exists with this email.")
}

// createUser insère le compte ; l'unicité de l'email (citext) est garantie par la base.
func (s *Service) createUser(ctx context.Context, q *dbgen.Queries, in AccountInput, role dbgen.UserRole) (uuid.UUID, error) {
	hash, err := s.Hasher.Hash(ctx, in.Password)
	if err != nil {
		return uuid.Nil, err
	}
	row, err := q.CreateUser(ctx, dbgen.CreateUserParams{
		Role: role, Email: in.Email, PasswordHash: hash, FirstName: in.FirstName, LastName: in.LastName,
		PrivacyPolicyVersion: in.PrivacyPolicyVersion,
	})
	if err != nil {
		if store.ConstraintName(err) == "uq_users_email" {
			return uuid.Nil, errEmailTaken().Wrap(err)
		}
		return uuid.Nil, fmt.Errorf("auth: create user: %w", err)
	}
	return row.ID, nil
}

// RegisterUser crée un compte utilisateur, envoie le code de vérification et ouvre une session
// (un compte non vérifié peut se connecter, D5).
func (s *Service) RegisterUser(ctx context.Context, in AccountInput, meta ClientMeta) (TokenPair, Profile, error) {
	v := &validator{}
	in = s.validateAccount(v, in)
	s.checkPassword(v, "password", in.Password, in.Email)
	if err := v.err(); err != nil {
		return TokenPair{}, Profile{}, err
	}
	uid, err := s.createUser(ctx, s.Store.Queries, in, dbgen.UserRoleUser)
	if err != nil {
		return TokenPair{}, Profile{}, err
	}
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &uid, ActorRole: string(dbgen.UserRoleUser),
		Action: audit.ActionUserRegistered, EntityType: "user", EntityID: uid.String(),
	})
	return s.afterRegistration(ctx, uid, in, string(dbgen.UserRoleUser), meta)
}

// RegisterManager crée le compte gérant et sa station (pending) avec le justificatif chiffré,
// dans une seule transaction. Le fichier est validé avant toute écriture.
func (s *Service) RegisterManager(ctx context.Context, in AccountInput, st StationInput, doc io.Reader, meta ClientMeta) (TokenPair, Profile, error) {
	v := &validator{}
	in = s.validateAccount(v, in)
	s.checkPassword(v, "password", in.Password, in.Email)
	station := dbgen.CreateStationParams{
		Name:    v.text("stationName", st.Name, 2, 120),
		Brand:   v.optional("brand", st.Brand, 60),
		Ifu:     v.ifu("ifu", st.IFU),
		Rccm:    v.rccm("rccm", st.RCCM),
		Address: v.text("address", st.Address, 5, 255),
		City:    v.optional("city", st.City, 100),
		Phone:   v.phone("phone", st.Phone),
	}
	if doc == nil {
		v.add("document", "required", "is required")
	}
	if err := v.err(); err != nil {
		return TokenPair{}, Profile{}, err
	}
	prepared, err := s.Documents.Prepare(doc)
	if err != nil {
		return TokenPair{}, Profile{}, err
	}

	var uid, stationID uuid.UUID
	var stored document.Stored
	err = s.Store.InTx(ctx, func(q *dbgen.Queries) error {
		var err error
		if uid, err = s.createUser(ctx, q, in, dbgen.UserRoleManager); err != nil {
			return err
		}
		if stored, err = s.Documents.Save(ctx, uid, prepared); err != nil {
			return err
		}
		station.ManagerID = &uid
		station.DocumentObjectKey = &stored.ObjectKey
		station.DocumentWrappedKey = stored.WrappedKey
		station.DocumentSha256 = stored.SHA256
		station.DocumentMime = &stored.MIME
		row, err := q.CreateStation(ctx, station)
		if err != nil {
			return fmt.Errorf("auth: create station: %w", err)
		}
		stationID = row.ID
		return nil
	})
	if err != nil {
		if stored.ObjectKey != "" { // transaction annulée : pas de fichier orphelin
			if delErr := s.Documents.Delete(context.WithoutCancel(ctx), stored.ObjectKey); delErr != nil {
				s.Log.ErrorContext(ctx, "auth: delete orphan document", slog.Any("err", delErr))
			}
		}
		return TokenPair{}, Profile{}, err
	}
	s.Audit.Log(ctx, audit.Entry{
		ActorID: &uid, ActorRole: string(dbgen.UserRoleManager),
		Action: audit.ActionManagerRegistered, EntityType: "station", EntityID: stationID.String(),
		Metadata: map[string]any{"documentMime": stored.MIME},
	})
	return s.afterRegistration(ctx, uid, in, string(dbgen.UserRoleManager), meta)
}

func (s *Service) afterRegistration(ctx context.Context, uid uuid.UUID, in AccountInput, role string, meta ClientMeta) (TokenPair, Profile, error) {
	s.issueAndSend(ctx, PurposeVerifyEmail, uid, in.Email, in.FirstName)
	tokens, err := s.openSession(ctx, uid, role, false, meta)
	if err != nil {
		return TokenPair{}, Profile{}, err
	}
	p, err := s.Profile(ctx, uid)
	return tokens, p, err
}
