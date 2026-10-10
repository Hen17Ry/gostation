// Commande admin : gestion des comptes administrateurs (aucune route publique ne permet d'en
// créer). La configuration est lue dans l'environnement, comme pour l'API.
//
//	admin create --email EMAIL --first-name PRÉNOM --last-name NOM
//	    crée un admin ; le mot de passe est saisi au clavier (deux fois, sans écho), ou lu sur
//	    la première ligne de l'entrée standard si elle n'est pas un terminal. Jamais en argument.
//	    La 2FA TOTP sera configurée au premier login sur l'admin web.
//	admin reset-2fa --email EMAIL
//	    supprime le secret TOTP et les codes de secours, révoque les sessions de l'admin.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	_ "time/tzdata"

	"golang.org/x/term"

	"gostation/backend/internal/app"
	"gostation/backend/internal/apperr"
	"gostation/backend/internal/config"
	"gostation/backend/internal/mail"
	"gostation/backend/internal/platform/logging"
	"gostation/backend/internal/platform/postgres"
	"gostation/backend/internal/platform/redis"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	err := run(ctx, os.Args[1:], os.Getenv, os.Stdin, os.Stdout, os.Stderr)
	stop()
	if err != nil {
		fmt.Fprintln(os.Stderr, "admin:", describe(err))
		os.Exit(1)
	}
}

// describe rend lisibles les erreurs de validation (une ligne par champ).
func describe(err error) string {
	if e, ok := apperr.As(err); ok && len(e.Fields) > 0 {
		var b strings.Builder
		b.WriteString(e.Detail)
		for _, f := range e.Fields {
			fmt.Fprintf(&b, "\n  - %s: %s", f.Field, f.Message)
		}
		return b.String()
	}
	return err.Error()
}

const usage = `usage:
  admin create --email EMAIL --first-name FIRST --last-name LAST
  admin reset-2fa --email EMAIL`

func run(ctx context.Context, args []string, getenv func(string) string, stdin io.Reader, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		return errors.New(usage)
	}
	cmd, rest := args[0], args[1:]
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	fs.SetOutput(stderr)
	email := fs.String("email", "", "admin email")
	first := fs.String("first-name", "", "first name (create)")
	last := fs.String("last-name", "", "last name (create)")
	if err := fs.Parse(rest); err != nil {
		return err
	}
	if *email == "" {
		return errors.New("--email is required\n" + usage)
	}

	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	log := logging.New(stderr, slog.LevelWarn, logging.FormatText, nil)
	pool, err := postgres.Connect(ctx, postgres.Options{URL: cfg.Postgres.URL, MaxConns: 2, AppName: "gostation-admin-cli"})
	if err != nil {
		return err
	}
	defer pool.Close()
	rdb, err := redis.Connect(ctx, cfg.Redis.URL)
	if err != nil {
		return err
	}
	defer func() { _ = rdb.Close() }()
	svc, err := app.NewServices(cfg, app.Infra{Pool: pool, Redis: rdb, Mailer: discardMailer{}}, log)
	if err != nil {
		return err
	}

	switch cmd {
	case "create":
		if *first == "" || *last == "" {
			return errors.New("--first-name and --last-name are required\n" + usage)
		}
		password, err := readPassword(stdin, stderr)
		if err != nil {
			return err
		}
		id, err := svc.Auth.CreateAdmin(ctx, *email, *first, *last, password)
		if err != nil {
			return err
		}
		fmt.Fprintf(stdout, "Admin created: %s (%s). Two-factor authentication will be set up at first sign-in.\n", *email, id)
	case "reset-2fa":
		id, err := svc.Auth.ResetAdmin2FA(ctx, *email)
		if err != nil {
			return err
		}
		fmt.Fprintf(stdout, "Two-factor authentication reset for %s (%s). Sessions revoked; set it up again at next sign-in.\n", *email, id)
	default:
		return fmt.Errorf("unknown command %q\n%s", cmd, usage)
	}
	return nil
}

// readPassword lit le mot de passe : au clavier sans écho (saisi deux fois) si stdin est un
// terminal, sinon sur la première ligne de stdin (scripts, CI).
func readPassword(stdin io.Reader, prompt io.Writer) (string, error) {
	if f, ok := stdin.(*os.File); ok && term.IsTerminal(int(f.Fd())) { //nolint:gosec // descripteur de fichier valide
		fmt.Fprint(prompt, "Password: ")
		p1, err := term.ReadPassword(int(f.Fd())) //nolint:gosec // idem
		fmt.Fprintln(prompt)
		if err != nil {
			return "", err
		}
		fmt.Fprint(prompt, "Confirm password: ")
		p2, err := term.ReadPassword(int(f.Fd())) //nolint:gosec // idem
		fmt.Fprintln(prompt)
		if err != nil {
			return "", err
		}
		if string(p1) != string(p2) {
			return "", errors.New("passwords do not match")
		}
		return string(p1), nil
	}
	line, err := bufio.NewReader(stdin).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	if line = strings.TrimRight(line, "\r\n"); line == "" {
		return "", errors.New("empty password on standard input")
	}
	return line, nil
}

// discardMailer : la CLI n'envoie aucun email.
type discardMailer struct{}

func (discardMailer) Send(context.Context, mail.Message) error { return nil }
