package auth

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"

	"gostation/backend/internal/apperr"
)

// Paramètres argon2id recommandés par l'OWASP (Password Storage Cheat Sheet) :
// m = 19 MiB, t = 2, p = 1. Encodés dans chaque hash (format PHC) : on peut les relever
// plus tard, les anciens hashes sont mis à niveau au login suivant.
const (
	argonMemoryKiB = 19 * 1024
	argonTime      = 2
	argonThreads   = 1
	argonSaltLen   = 16
	argonKeyLen    = 32
)

// Limites de la politique de mot de passe.
const (
	PasswordMinLen = 8
	PasswordMaxLen = 128
)

var errMalformedHash = errors.New("auth: malformed password hash")

// PasswordHasher hache et vérifie les mots de passe. Un sémaphore borne le nombre de
// calculs simultanés (19 MiB chacun) pour protéger la mémoire du serveur.
type PasswordHasher struct {
	sem chan struct{}
	// dummy sert à vérifier un mot de passe quand le compte n'existe pas, pour que le temps
	// de réponse ne révèle pas l'existence de l'email.
	dummy string
}

// NewPasswordHasher construit le hasher ; concurrency borne les calculs simultanés.
func NewPasswordHasher(concurrency int) *PasswordHasher {
	h := &PasswordHasher{sem: make(chan struct{}, max(1, concurrency))}
	h.dummy = h.hash([]byte("dummy password for timing equalization"))
	return h
}

func (h *PasswordHasher) acquire(ctx context.Context) error {
	select {
	case h.sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (h *PasswordHasher) release() { <-h.sem }

func (h *PasswordHasher) hash(password []byte) string {
	salt := make([]byte, argonSaltLen)
	_, _ = rand.Read(salt)
	key := argon2.IDKey(password, salt, argonTime, argonMemoryKiB, argonThreads, argonKeyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemoryKiB, argonTime, argonThreads, b64.EncodeToString(salt), b64.EncodeToString(key))
}

// Hash renvoie le hash PHC du mot de passe.
func (h *PasswordHasher) Hash(ctx context.Context, password string) (string, error) {
	if err := h.acquire(ctx); err != nil {
		return "", err
	}
	defer h.release()
	return h.hash([]byte(password)), nil
}

type phc struct {
	memory  uint32
	time    uint32
	threads uint8
	salt    []byte
	key     []byte
}

func parsePHC(encoded string) (phc, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return phc{}, errMalformedHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return phc{}, errMalformedHash
	}
	var p phc
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memory, &p.time, &p.threads); err != nil {
		return phc{}, errMalformedHash
	}
	var err error
	if p.salt, err = base64.RawStdEncoding.DecodeString(parts[4]); err != nil {
		return phc{}, errMalformedHash
	}
	if p.key, err = base64.RawStdEncoding.DecodeString(parts[5]); err != nil || len(p.key) == 0 {
		return phc{}, errMalformedHash
	}
	return p, nil
}

// Verify compare le mot de passe au hash en temps constant. needsRehash indique que le hash
// utilise d'anciens paramètres et doit être recalculé.
func (h *PasswordHasher) Verify(ctx context.Context, password, encoded string) (ok, needsRehash bool, err error) {
	p, parseErr := parsePHC(encoded)
	malformed := parseErr != nil
	if malformed {
		// Hash invalide ou compte anonymisé ('!') : on calcule quand même pour un temps constant.
		p, _ = parsePHC(h.dummy)
	}
	if err := h.acquire(ctx); err != nil {
		return false, false, err
	}
	key := argon2.IDKey([]byte(password), p.salt, p.time, p.memory, p.threads, uint32(len(p.key))) //nolint:gosec // longueur bornée par le hash
	h.release()
	if malformed {
		return false, false, nil //nolint:nilerr // hash illisible = mot de passe refusé, pas une erreur technique
	}
	ok = subtle.ConstantTimeCompare(key, p.key) == 1
	needsRehash = p.memory != argonMemoryKiB || p.time != argonTime || p.threads != argonThreads || len(p.key) != argonKeyLen
	return ok, needsRehash, nil
}

// VerifyDummy consomme le même temps qu'une vraie vérification (compte inexistant).
func (h *PasswordHasher) VerifyDummy(ctx context.Context, password string) {
	_, _, _ = h.Verify(ctx, password, h.dummy)
}

//go:embed common_passwords.txt
var commonPasswordsFile []byte

// PasswordPolicy valide les nouveaux mots de passe : longueur, liste des mots de passe
// courants, et mots liés au contexte (email, nom du service).
type PasswordPolicy struct {
	common map[string]struct{}
}

// NewPasswordPolicy charge la liste embarquée.
func NewPasswordPolicy() *PasswordPolicy {
	common := make(map[string]struct{}, 2500)
	sc := bufio.NewScanner(bytes.NewReader(commonPasswordsFile))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line != "" && !strings.HasPrefix(line, "#") {
			common[line] = struct{}{}
		}
	}
	return &PasswordPolicy{common: common}
}

// Validate renvoie une erreur de validation (422) sur le champ field, ou nil.
func (p *PasswordPolicy) Validate(field, password, email string) error {
	n := utf8.RuneCountInString(password)
	switch {
	case n < PasswordMinLen:
		return apperr.Validation(apperr.FieldError{
			Field: field, Code: "too_short",
			Message: fmt.Sprintf("must be at least %d characters", PasswordMinLen),
		})
	case n > PasswordMaxLen:
		return apperr.Validation(apperr.FieldError{
			Field: field, Code: "too_long",
			Message: fmt.Sprintf("must be at most %d characters", PasswordMaxLen),
		})
	}
	lower := strings.ToLower(password)
	if _, found := p.common[lower]; found {
		return apperr.Validation(apperr.FieldError{
			Field: field, Code: "too_common",
			Message: "is too common, choose a less predictable password",
		})
	}
	local, _, _ := strings.Cut(strings.ToLower(email), "@")
	if strings.Contains(lower, "gostation") || (len(local) >= 4 && strings.Contains(lower, local)) {
		return apperr.Validation(apperr.FieldError{
			Field: field, Code: "too_predictable",
			Message: "must not contain your email or the service name",
		})
	}
	return nil
}
