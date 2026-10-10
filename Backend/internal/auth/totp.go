package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" //nolint:gosec // HMAC-SHA1 est l'algorithme TOTP par défaut (RFC 6238), compris par toutes les applis
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// Paramètres TOTP (RFC 6238) compatibles avec Google Authenticator, Aegis, 1Password… :
// HMAC-SHA1, 6 chiffres, pas de 30 s, tolérance d'un pas avant/après (dérive d'horloge).
const (
	TOTPDigits    = 6
	TOTPPeriod    = 30 * time.Second
	TOTPSkew      = 1
	totpSecretLen = 20 // 160 bits, recommandé par la RFC 4226
	totpIssuer    = "GoStation"
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewTOTPSecret génère un secret aléatoire.
func NewTOTPSecret() []byte {
	s := make([]byte, totpSecretLen)
	_, _ = rand.Read(s)
	return s
}

// TOTPSecretBase32 encode le secret pour la saisie manuelle.
func TOTPSecretBase32(secret []byte) string { return b32.EncodeToString(secret) }

// TOTPURI construit l'URI otpauth:// (affichée en QR code par l'admin web).
func TOTPURI(secret []byte, account string) string {
	label := url.PathEscape(totpIssuer + ":" + account)
	q := url.Values{
		"secret":    {TOTPSecretBase32(secret)},
		"issuer":    {totpIssuer},
		"algorithm": {"SHA1"},
		"digits":    {fmt.Sprint(TOTPDigits)},
		"period":    {fmt.Sprint(int(TOTPPeriod.Seconds()))},
	}
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// hotp calcule HOTP(secret, counter) sur digits chiffres (RFC 4226 §5.3).
func hotp(secret []byte, counter uint64, digits int) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, secret)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	bin := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	mod := uint32(1)
	for range digits {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", digits, bin%mod)
}

// TOTPCode renvoie le code valide à l'instant t.
func TOTPCode(secret []byte, t time.Time) string {
	return hotp(secret, uint64(t.Unix())/uint64(TOTPPeriod.Seconds()), TOTPDigits) //nolint:gosec // t est postérieur à 1970
}

// VerifyTOTP vérifie code à l'instant t (± TOTPSkew pas) et renvoie le pas accepté, que
// l'appelant mémorise pour refuser qu'un même code serve deux fois.
func VerifyTOTP(secret []byte, code string, t time.Time) (step int64, ok bool) {
	code = strings.ReplaceAll(code, " ", "")
	if len(code) != TOTPDigits {
		return 0, false
	}
	current := t.Unix() / int64(TOTPPeriod.Seconds())
	for d := -TOTPSkew; d <= TOTPSkew; d++ {
		s := current + int64(d)
		if subtle.ConstantTimeCompare([]byte(hotp(secret, uint64(s), TOTPDigits)), []byte(code)) == 1 { //nolint:gosec // s > 0
			return s, true
		}
	}
	return 0, false
}

// Codes de secours : 10 codes de 16 caractères base32 (80 bits), affichés une seule fois,
// stockés en SHA-256 (l'entropie rend argon2 inutile).
const (
	RecoveryCodeCount = 10
	recoveryCodeBytes = 10
)

// NewRecoveryCodes génère les codes, au format XXXX-XXXX-XXXX-XXXX.
func NewRecoveryCodes() []string {
	codes := make([]string, RecoveryCodeCount)
	for i := range codes {
		b := make([]byte, recoveryCodeBytes)
		_, _ = rand.Read(b)
		raw := b32.EncodeToString(b) // 16 caractères
		codes[i] = raw[0:4] + "-" + raw[4:8] + "-" + raw[8:12] + "-" + raw[12:16]
	}
	return codes
}

// HashRecoveryCode normalise (casse, tirets, espaces) puis hache un code de secours.
func HashRecoveryCode(code string) []byte {
	normalized := strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(code))
	sum := sha256.Sum256([]byte(normalized))
	return sum[:]
}
