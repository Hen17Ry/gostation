// Commande e2efixtures : crée les données des tests E2E de l'admin web (Web/e2e), en passant par
// les services de l'application (mêmes règles que l'API), et les décrit en JSON sur la sortie.
//
// Garde-fou : elle refuse toute base dont le nom ne finit pas par « _e2e » et APP_ENV=production.
// La base E2E est créée, migrée et supprimée par Web/e2e/stack/start.sh à chaque exécution.
//
// Les emails des comptes de test sont marqués vérifiés directement en base (pas de lecture des
// codes) : c'est le seul raccourci, le reste suit les parcours réels (inscription avec
// justificatif chiffré, validation admin, épinglage, horaires, produits, stocks, signalements).
//
// Usage : e2efixtures > fixtures.json
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"net/url"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"gostation/backend/internal/app"
	"gostation/backend/internal/auth"
	"gostation/backend/internal/catalog"
	"gostation/backend/internal/config"
	"gostation/backend/internal/platform/osrm"
	"gostation/backend/internal/platform/postgres"
	"gostation/backend/internal/platform/redis"
	"gostation/backend/internal/platform/storage"
	"gostation/backend/internal/report"
	"gostation/backend/internal/station"
)

func main() {
	if err := run(context.Background(), os.Getenv, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "e2efixtures:", err)
		os.Exit(1)
	}
}

// StationFixture décrit une station créée pour un scénario.
type StationFixture struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	IFU          string `json:"ifu"`
	ManagerEmail string `json:"managerEmail"`
}

// Fixtures est la sortie JSON, lue par les tests Playwright.
type Fixtures struct {
	Run            string         `json:"run"`
	PendingApprove StationFixture `json:"pendingApprove"`
	PendingReject  StationFixture `json:"pendingReject"`
	Move           StationFixture `json:"move"`
	Correct        StationFixture `json:"correct"`
	Reported       StationFixture `json:"reported"`
	ReportID       string         `json:"reportId"`
	Excluded       StationFixture `json:"excluded"`
	User           struct {
		ID    string `json:"id"`
		Email string `json:"email"`
		Name  string `json:"name"`
	} `json:"user"`
	Product struct {
		ID       int16  `json:"id"`
		Label    string `json:"label"`
		Stations int    `json:"stations"`
	} `json:"product"`
}

type fixer struct {
	ctx   context.Context
	pool  *pgxpool.Pool
	svc   *app.Services
	admin station.Actor
	run   string
	seq   int
}

func run(ctx context.Context, getenv func(string) string, out io.Writer) error {
	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	if err := guard(cfg); err != nil {
		return err
	}
	pool, err := postgres.Connect(ctx, postgres.Options{URL: cfg.Postgres.URL, AppName: "gostation-e2efixtures"})
	if err != nil {
		return err
	}
	defer pool.Close()
	rdb, err := redis.Connect(ctx, cfg.Redis.URL)
	if err != nil {
		return err
	}
	defer func() { _ = rdb.Close() }()
	osrmClient, err := osrm.New(cfg.OSRM.URL, cfg.OSRM.Timeout)
	if err != nil {
		return err
	}
	docs, err := storage.NewLocal(cfg.Documents.StorageDir)
	if err != nil {
		return err
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	svc, err := app.NewServices(cfg, app.Infra{Pool: pool, Redis: rdb, Storage: docs, OSRM: osrmClient}, log)
	if err != nil {
		return err
	}
	defer func() { _ = svc.Jobs.Close() }()

	b := make([]byte, 3)
	_, _ = rand.Read(b)
	f := &fixer{ctx: ctx, pool: pool, svc: svc, run: hex.EncodeToString(b)}
	adminID, err := svc.Auth.CreateAdmin(ctx, f.email("fixtures"), "Fixtures", "E2E", "Lagune-"+f.run+"-Ouidah")
	if err != nil {
		return fmt.Errorf("fixtures admin: %w", err)
	}
	f.admin = station.Actor{UserID: adminID, Role: "admin"}

	var fx Fixtures
	fx.Run = f.run
	if fx.PendingApprove, err = f.manager("Station Akpakpa Carrefour", "Cotonou", pdfDoc("Station Akpakpa Carrefour")); err != nil {
		return err
	}
	if fx.PendingReject, err = f.manager("Station Godomey Echangeur", "Abomey-Calavi", pngDoc()); err != nil {
		return err
	}

	// Station approuvée, épinglée à 800 m de l'appareil du gérant (épingle signalée), puis une
	// demande de déplacement de 1,2 km en attente de l'admin.
	if fx.Move, err = f.manager("Station Ganhi Marina", "Cotonou", pdfDoc("Station Ganhi Marina")); err != nil {
		return err
	}
	if err := f.approve(fx.Move.ID); err != nil {
		return err
	}
	if err := f.pin(fx.Move.ManagerEmail, 6.3555, 2.4330, &station.DevicePosition{Lat: 6.3627, Lng: 2.4330, AccuracyM: 12}); err != nil {
		return err
	}
	if err := f.pin(fx.Move.ManagerEmail, 6.3663, 2.4330, nil); err != nil {
		return err
	}

	// Station approuvée et complète (horaires, produits, stocks) : correction avec conflit 412.
	if fx.Correct, err = f.operational("Station Cadjèhoun Aéroport", "Cotonou", 6.3570, 2.3830); err != nil {
		return err
	}

	// Signalement « autre » ouvert, avec commentaire.
	if fx.Reported, err = f.operational("Station Fidjrossè Plage", "Cotonou", 6.3480, 2.3520); err != nil {
		return err
	}
	reporter, err := f.user("Koffi", "Agbodjan")
	if err != nil {
		return err
	}
	comment := "Le gérant refuse de vendre le gaz 12,5 kg alors qu'il en a."
	rep, err := svc.Reports.Create(ctx, reporter, uuid.MustParse(fx.Reported.ID), report.Input{Reason: report.ReasonOther, Comment: &comment})
	if err != nil {
		return fmt.Errorf("report: %w", err)
	}
	fx.ReportID = rep.ID.String()

	// Cinq signalements « position incorrecte » d'auteurs distincts : exclusion + alerte admin.
	if fx.Excluded, err = f.operational("Station Calavi Kpota", "Abomey-Calavi", 6.4490, 2.3550); err != nil {
		return err
	}
	for i := range 5 {
		uid, err := f.user("Afi", fmt.Sprintf("Dossou %d", i+1))
		if err != nil {
			return err
		}
		if _, err := svc.Reports.Create(ctx, uid, uuid.MustParse(fx.Excluded.ID), report.Input{Reason: report.ReasonWrongLocation}); err != nil {
			return fmt.Errorf("threshold report %d: %w", i+1, err)
		}
	}

	// Compte utilisateur à désactiver.
	userEmail := f.email("adjoa")
	uid, err := f.userWithEmail("Adjoa", "Kiki", userEmail)
	if err != nil {
		return err
	}
	fx.User.ID, fx.User.Email, fx.User.Name = uid.String(), userEmail, "Adjoa Kiki"

	// Produit vendu par deux stations : dialogue d'impact à la désactivation.
	size := 7.5
	label := "Gaz 7,5 kg"
	p, err := svc.Catalog.Create(ctx, catalog.Actor{UserID: adminID, Role: "admin"}, catalog.CreateInput{Kind: "lpg", SizeKg: &size, Label: label})
	if err != nil {
		return fmt.Errorf("product: %w", err)
	}
	for _, st := range []StationFixture{fx.Correct, fx.Reported} {
		if err := f.addProduct(st.ManagerEmail, p.ID); err != nil {
			return err
		}
	}
	fx.Product.ID, fx.Product.Label, fx.Product.Stations = p.ID, label, 2

	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	return enc.Encode(fx)
}

// guard refuse toute base qui n'est pas une base E2E jetable.
func guard(cfg config.Config) error {
	if cfg.Env == config.EnvProduction {
		return errors.New("refusing to run with APP_ENV=production")
	}
	u, err := url.Parse(cfg.Postgres.URL)
	if err != nil {
		return fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	if name := strings.TrimPrefix(u.Path, "/"); !strings.HasSuffix(name, "_e2e") {
		return fmt.Errorf("refusing to seed database %q: its name must end with _e2e", name)
	}
	return nil
}

func (f *fixer) email(prefix string) string {
	f.seq++
	return fmt.Sprintf("%s.%s.%d@example.bj", prefix, f.run, f.seq)
}

func (f *fixer) ifu() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	n := uint64(0)
	for _, x := range b {
		n = n<<8 | uint64(x)
	}
	return fmt.Sprintf("32%011d", n%100_000_000_000)
}

func (f *fixer) verify(email string) error {
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET email_verified_at = now() WHERE email = $1`, email); err != nil {
		return fmt.Errorf("verify %s: %w", email, err)
	}
	return nil
}

func (f *fixer) account(first, last, email string) auth.AccountInput {
	return auth.AccountInput{FirstName: first, LastName: last, Email: email, Password: "Lagune-" + f.run + "-Porto", PrivacyPolicyVersion: "1.0"}
}

// manager inscrit un gérant (justificatif chiffré compris) et vérifie son email : dossier en attente.
func (f *fixer) manager(name, city string, doc []byte) (StationFixture, error) {
	email := f.email("gerant")
	ifu := f.ifu()
	_, prof, err := f.svc.Auth.RegisterManager(f.ctx, f.account("Bio", "Tchané", email), auth.StationInput{
		Name: name, Brand: "Oryx", IFU: ifu, RCCM: "RB/COT/26 B 1" + f.run[:4], Address: "Boulevard de la Marina",
		City: city, Phone: "+22997000000",
	}, bytes.NewReader(doc), auth.ClientMeta{Client: auth.ClientMobile, UserAgent: "e2efixtures"})
	if err != nil {
		return StationFixture{}, fmt.Errorf("register manager %s: %w", name, err)
	}
	if err := f.verify(email); err != nil {
		return StationFixture{}, err
	}
	return StationFixture{ID: prof.Station.ID.String(), Name: name, IFU: ifu, ManagerEmail: email}, nil
}

func (f *fixer) approve(stationID string) error {
	id := uuid.MustParse(stationID)
	st, err := f.svc.Station.AdminDetail(f.ctx, id)
	if err != nil {
		return err
	}
	if _, err := f.svc.Station.ChangeStatus(f.ctx, f.admin, id, st.Version, "approve", ""); err != nil {
		return fmt.Errorf("approve %s: %w", stationID, err)
	}
	return nil
}

// managerActor retrouve le gérant (et la version de sa station) par son email.
func (f *fixer) managerActor(email string) (station.Actor, int32, error) {
	var uid uuid.UUID
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&uid); err != nil {
		return station.Actor{}, 0, fmt.Errorf("manager %s: %w", email, err)
	}
	ms, err := f.svc.Station.ForManager(f.ctx, uid)
	if err != nil {
		return station.Actor{}, 0, err
	}
	return station.Actor{UserID: uid, Role: "manager"}, ms.Version, nil
}

func (f *fixer) pin(email string, lat, lng float64, device *station.DevicePosition) error {
	a, v, err := f.managerActor(email)
	if err != nil {
		return err
	}
	if _, err := f.svc.Station.SetLocation(f.ctx, a, v, station.LocationInput{Lat: lat, Lng: lng, Confirm: true, Device: device}); err != nil {
		return fmt.Errorf("pin %s: %w", email, err)
	}
	return nil
}

// operational crée une station approuvée, épinglée, ouverte 24 h/24, avec trois produits en stock.
func (f *fixer) operational(name, city string, lat, lng float64) (StationFixture, error) {
	st, err := f.manager(name, city, pdfDoc(name))
	if err != nil {
		return st, err
	}
	if err := f.approve(st.ID); err != nil {
		return st, err
	}
	if err := f.pin(st.ManagerEmail, lat, lng, &station.DevicePosition{Lat: lat, Lng: lng, AccuracyM: 8}); err != nil {
		return st, err
	}
	a, v, err := f.managerActor(st.ManagerEmail)
	if err != nil {
		return st, err
	}
	if _, err := f.svc.Station.ReplaceHours(f.ctx, a, v, station.HoursInput{AllWeek24h: true}); err != nil {
		return st, fmt.Errorf("hours %s: %w", name, err)
	}
	ids, err := f.productIDs("lpg_10kg", "petrol", "diesel")
	if err != nil {
		return st, err
	}
	a, v, _ = f.managerActor(st.ManagerEmail)
	if _, err := f.svc.Station.SetProducts(f.ctx, a, v, ids); err != nil {
		return st, fmt.Errorf("products %s: %w", name, err)
	}
	a, v, _ = f.managerActor(st.ManagerEmail)
	if _, err := f.svc.Station.UpdateStocks(f.ctx, a, v, []station.StockInput{
		{ProductID: ids[0], Quantity: 42}, {ProductID: ids[1], Quantity: 12500}, {ProductID: ids[2], Quantity: 0},
	}); err != nil {
		return st, fmt.Errorf("stocks %s: %w", name, err)
	}
	return st, nil
}

func (f *fixer) addProduct(email string, productID int16) error {
	a, v, err := f.managerActor(email)
	if err != nil {
		return err
	}
	view, err := f.svc.Station.Products(f.ctx, a.UserID)
	if err != nil {
		return err
	}
	ids := []int16{productID}
	for _, p := range view.Items {
		if p.Sold {
			ids = append(ids, p.ID)
		}
	}
	if _, err := f.svc.Station.SetProducts(f.ctx, a, v, ids); err != nil {
		return fmt.Errorf("add product to %s: %w", email, err)
	}
	return nil
}

func (f *fixer) productIDs(codes ...string) ([]int16, error) {
	out := make([]int16, len(codes))
	for i, c := range codes {
		if err := f.pool.QueryRow(f.ctx, `SELECT id FROM products WHERE code = $1`, c).Scan(&out[i]); err != nil {
			return nil, fmt.Errorf("product %s: %w", c, err)
		}
	}
	return out, nil
}

func (f *fixer) user(first, last string) (uuid.UUID, error) {
	return f.userWithEmail(first, last, f.email(strings.ToLower(first)))
}

func (f *fixer) userWithEmail(first, last, email string) (uuid.UUID, error) {
	_, prof, err := f.svc.Auth.RegisterUser(f.ctx, f.account(first, last, email), auth.ClientMeta{Client: auth.ClientMobile, UserAgent: "e2efixtures"})
	if err != nil {
		return uuid.Nil, fmt.Errorf("register user: %w", err)
	}
	return prof.ID, f.verify(email)
}

// pdfDoc génère un PDF d'une page (attestation de démonstration), lisible par les navigateurs.
func pdfDoc(station string) []byte {
	text := "BT /F1 20 Tf 72 760 Td (Attestation d'immatriculation IFU) Tj 0 -30 Td /F1 12 Tf (" +
		asciiOnly(station) + " - document de demonstration (tests E2E)) Tj 0 -20 Td (Aucune valeur administrative.) Tj ET"
	objs := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(text), text),
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objs))
	for i, o := range objs {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, off := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	return b.Bytes()
}

func asciiOnly(s string) string {
	r := strings.NewReplacer("è", "e", "é", "e", "ê", "e", "à", "a", "ç", "c", "(", "", ")", "")
	return r.Replace(s)
}

// pngDoc génère une image (justificatif scanné de démonstration) : bandeau orange, lignes de texte
// simulées.
func pngDoc() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 900, 640))
	for y := range 640 {
		for x := range 900 {
			c := color.RGBA{250, 248, 245, 255}
			switch {
			case y < 90:
				c = color.RGBA{209, 66, 0, 255}
			case y > 130 && y < 600 && (y-130)%42 < 12 && x > 60 && x < 840-((y/42)%3)*120:
				c = color.RGBA{200, 195, 190, 255}
			}
			img.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}
