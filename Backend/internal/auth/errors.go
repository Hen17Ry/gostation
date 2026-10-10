package auth

import (
	"fmt"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"unicode/utf8"

	"gostation/backend/internal/apperr"
)

// Codes d'erreur stables du domaine auth (docs/ARCHITECTURE.md §5).
//
//nolint:gosec // G101 : identifiants de codes d'erreur, pas des secrets
const (
	CodeInvalidCredentials  = "auth.invalid_credentials"
	CodeEmailTaken          = "auth.email_taken"
	CodeInvalidCode         = "auth.invalid_code"
	CodeInvalidRefreshToken = "auth.invalid_refresh_token"
	CodeInvalidMFAToken     = "auth.invalid_mfa_token"
	CodeInvalidSecondFactor = "auth.invalid_second_factor"
	CodeEmailNotVerified    = "auth.email_not_verified"
	CodeCSRFFailed          = "auth.csrf_failed"
	CodeStationNotApproved  = "station.not_approved"
)

// Erreurs renvoyées aux clients. Les messages restent génériques là où un message précis
// révélerait l'existence d'un compte (login, codes).
func errInvalidCredentials() *apperr.Error {
	return apperr.New(http.StatusUnauthorized, CodeInvalidCredentials, "Invalid email or password.")
}

func errInvalidCode() *apperr.Error {
	return apperr.New(http.StatusBadRequest, CodeInvalidCode, "Invalid or expired code.")
}

func errInvalidRefresh() *apperr.Error {
	return apperr.New(http.StatusUnauthorized, CodeInvalidRefreshToken, "Invalid or expired refresh token.")
}

func errInvalidMFAToken() *apperr.Error {
	return apperr.New(http.StatusUnauthorized, CodeInvalidMFAToken, "Invalid or expired two-factor challenge, sign in again.")
}

func errInvalidSecondFactor() *apperr.Error {
	return apperr.New(http.StatusUnauthorized, CodeInvalidSecondFactor, "Invalid authentication code.")
}

// validator accumule les erreurs de champ.
type validator struct {
	fields []apperr.FieldError
}

func (v *validator) add(field, code, msg string) {
	v.fields = append(v.fields, apperr.FieldError{Field: field, Code: code, Message: msg})
}

func (v *validator) err() error {
	if len(v.fields) == 0 {
		return nil
	}
	return apperr.Validation(v.fields...)
}

// text valide un texte obligatoire (après TrimSpace) de longueur [minLen, maxLen] caractères.
func (v *validator) text(field, value string, minLen, maxLen int) string {
	value = strings.TrimSpace(value)
	n := utf8.RuneCountInString(value)
	switch {
	case n == 0:
		v.add(field, "required", "is required")
	case n < minLen:
		v.add(field, "too_short", fmt.Sprintf("must be at least %d characters", minLen))
	case n > maxLen:
		v.add(field, "too_long", fmt.Sprintf("must be at most %d characters", maxLen))
	}
	return value
}

// optional valide un texte facultatif ; renvoie nil s'il est vide.
func (v *validator) optional(field, value string, maxLen int) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if utf8.RuneCountInString(value) > maxLen {
		v.add(field, "too_long", fmt.Sprintf("must be at most %d characters", maxLen))
	}
	return &value
}

// email valide une adresse simple (sans nom affiché), ≤ 254 caractères.
func (v *validator) email(field, value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		v.add(field, "required", "is required")
		return value
	}
	addr, err := mail.ParseAddress(value)
	if err != nil || addr.Address != value || len(value) > 254 || !strings.Contains(value[strings.LastIndex(value, "@"):], ".") {
		v.add(field, "invalid", "must be a valid email address")
	}
	return value
}

var (
	ifuPattern   = regexp.MustCompile(`^[0-9]{13}$`)
	rccmPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 /.\-]{3,48}[A-Za-z0-9]$`)
	phonePattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)
	phoneNoise   = strings.NewReplacer(" ", "", ".", "", "-", "", "(", "", ")", "")
)

func (v *validator) ifu(field, value string) string {
	value = strings.TrimSpace(value)
	if !ifuPattern.MatchString(value) {
		v.add(field, "invalid", "must be exactly 13 digits")
	}
	return value
}

func (v *validator) rccm(field, value string) string {
	value = strings.ToUpper(strings.Join(strings.Fields(value), " "))
	if !rccmPattern.MatchString(value) {
		v.add(field, "invalid", "must be a registry number such as RB/COT/24 B 12345")
	}
	return value
}

// phone normalise (espaces, points, tirets) et exige le format E.164 (+229…).
func (v *validator) phone(field, value string) string {
	value = phoneNoise.Replace(strings.TrimSpace(value))
	if !phonePattern.MatchString(value) {
		v.add(field, "invalid", "must be an international number such as +2290190000000")
	}
	return value
}
