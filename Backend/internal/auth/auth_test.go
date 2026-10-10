package auth

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"

	"gostation/backend/internal/apperr"
)

// ── Mots de passe ───────────────────────────────────────────────────────────

func TestPasswordHashAndVerify(t *testing.T) {
	h := NewPasswordHasher(2)
	ctx := context.Background()
	hash, err := h.Hash(ctx, "Correct-Horse-42")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("hash %q does not use OWASP parameters", hash)
	}
	if ok, rehash, err := h.Verify(ctx, "Correct-Horse-42", hash); err != nil || !ok || rehash {
		t.Fatalf("Verify(correct) = %v %v %v", ok, rehash, err)
	}
	if ok, _, _ := h.Verify(ctx, "correct-horse-42", hash); ok {
		t.Fatal("Verify accepted a wrong password")
	}
	other, _ := h.Hash(ctx, "Correct-Horse-42")
	if other == hash {
		t.Fatal("two hashes of the same password must differ (random salt)")
	}
}

func TestPasswordVerifyEdgeCases(t *testing.T) {
	h := NewPasswordHasher(1)
	ctx := context.Background()
	for _, encoded := range []string{"!", "", "$argon2i$v=19$m=1,t=1,p=1$AA$AA", "$argon2id$v=19$m=x$AA$AA"} {
		if ok, _, err := h.Verify(ctx, "whatever", encoded); ok || err != nil {
			t.Errorf("Verify(%q) = %v, %v; want false, nil", encoded, ok, err)
		}
	}
	// Un hash aux anciens paramètres (m = 64 MiB) est accepté mais doit être recalculé.
	b64 := base64.RawStdEncoding
	salt := []byte("0123456789abcdef")
	legacy := "$argon2id$v=19$m=65536,t=1,p=1$" + b64.EncodeToString(salt) + "$" +
		b64.EncodeToString(argon2Key("old-password", salt, 1, 65536, 1))
	if ok, rehash, err := h.Verify(ctx, "old-password", legacy); !ok || !rehash || err != nil {
		t.Fatalf("legacy hash: ok=%v rehash=%v err=%v", ok, rehash, err)
	}
}

func argon2Key(password string, salt []byte, time, memory uint32, threads uint8) []byte {
	return argon2.IDKey([]byte(password), salt, time, memory, threads, 32)
}

func TestPasswordPolicy(t *testing.T) {
	p := NewPasswordPolicy()
	tests := []struct {
		password, email, code string
	}{
		{"Short1!", "a@b.bj", "too_short"},
		{strings.Repeat("x", 129), "a@b.bj", "too_long"},
		{"password123", "a@b.bj", "too_common"},
		{"PassWord123", "a@b.bj", "too_common"},
		{"azertyuiop", "a@b.bj", "too_common"},
		{"motdepasse", "a@b.bj", "too_common"},
		{"MyGoStation#2026", "a@b.bj", "too_predictable"},
		{"kofi.mensah-2026!", "kofi.mensah@example.bj", "too_predictable"},
		{"Lagune-Cotonou-88", "kofi@example.bj", ""},
		{"éléphant rose", "a@b.bj", ""},
	}
	for _, tt := range tests {
		err := p.Validate("password", tt.password, tt.email)
		if tt.code == "" {
			if err != nil {
				t.Errorf("Validate(%q) = %v, want nil", tt.password, err)
			}
			continue
		}
		e, ok := apperr.As(err)
		if !ok || len(e.Fields) != 1 || e.Fields[0].Code != tt.code || e.Fields[0].Field != "password" {
			t.Errorf("Validate(%q) = %v, want field error %s", tt.password, err, tt.code)
		}
	}
	if len(p.common) < 2000 {
		t.Errorf("common password list has %d entries, want > 2000", len(p.common))
	}
}

// ── Access tokens ───────────────────────────────────────────────────────────

func key(t *testing.T, kid, seedHex string) SigningKey {
	t.Helper()
	keys, err := ParseSigningKeys(kid + ":" + seedHex)
	if err != nil {
		t.Fatal(err)
	}
	return keys[0]
}

func TestTokensIssueVerifyAndRotation(t *testing.T) {
	k1 := key(t, "k1", strings.Repeat("11", 32))
	k2 := key(t, "k2", strings.Repeat("22", 32))
	old := NewTokenManager([]SigningKey{k1}, "gostation-api", "gostation", 15*time.Minute)
	current := NewTokenManager([]SigningKey{k2, k1}, "gostation-api", "gostation", 15*time.Minute)
	uid := uuid.New()

	tok, err := current.Issue(uid, "manager", "sess-1", false)
	if err != nil {
		t.Fatal(err)
	}
	c, err := current.Verify(tok)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := c.UserID(); got != uid || c.Role != "manager" || c.SID != "sess-1" || c.MFA {
		t.Errorf("claims = %+v", c)
	}
	if parsed, _, _ := jwt.NewParser().ParseUnverified(tok, &Claims{}); parsed.Header["kid"] != "k2" || parsed.Header["alg"] != "EdDSA" {
		t.Errorf("header = %v, want kid k2 and alg EdDSA", parsed.Header)
	}

	// Rotation : un token signé par l'ancienne clé reste valide tant qu'elle est listée.
	oldTok, _ := old.Issue(uid, "user", "sess-0", false)
	if _, err := current.Verify(oldTok); err != nil {
		t.Errorf("token signed with retired-but-listed key rejected: %v", err)
	}
	// Une fois la clé retirée, il est refusé.
	if _, err := NewTokenManager([]SigningKey{k2}, "gostation-api", "gostation", time.Minute).Verify(oldTok); err == nil {
		t.Error("token signed with removed key accepted")
	}
}

func TestTokensRejectForgeries(t *testing.T) {
	k1 := key(t, "k1", strings.Repeat("11", 32))
	m := NewTokenManager([]SigningKey{k1}, "gostation-api", "gostation", 15*time.Minute)
	uid := uuid.New()
	valid, _ := m.Issue(uid, "admin", "s", true)

	// Confusion d'algorithme : HS256 signé avec la clé publique, même kid.
	pub := k1.Private.Public().(ed25519.PublicKey)
	hs := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "gostation-api", Subject: uid.String(), Audience: jwt.ClaimStrings{"gostation"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now()),
		},
		Role: "admin", SID: "s", MFA: true,
	})
	hs.Header["kid"] = "k1"
	hsTok, _ := hs.SignedString([]byte(pub))

	parts := strings.Split(valid, ".")
	tampered := parts[0] + "." + base64.RawURLEncoding.EncodeToString([]byte(`{"role":"admin","sid":"x","sub":"`+uid.String()+`"}`)) + "." + parts[2]

	expired := NewTokenManager([]SigningKey{k1}, "gostation-api", "gostation", time.Minute)
	expired.now = func() time.Time { return time.Now().Add(-2 * time.Hour) }
	expiredTok, _ := expired.Issue(uid, "user", "s", false)

	otherAud, _ := NewTokenManager([]SigningKey{k1}, "gostation-api", "someone-else", time.Minute).Issue(uid, "user", "s", false)
	otherIss, _ := NewTokenManager([]SigningKey{k1}, "evil", "gostation", time.Minute).Issue(uid, "user", "s", false)

	for name, tok := range map[string]string{
		"alg confusion": hsTok, "tampered payload": tampered, "expired": expiredTok,
		"wrong audience": otherAud, "wrong issuer": otherIss, "garbage": "a.b.c", "empty": "",
	} {
		if _, err := m.Verify(tok); !errors.Is(err, ErrInvalidToken) {
			t.Errorf("%s: Verify error = %v, want ErrInvalidToken", name, err)
		}
	}
}

func TestParseSigningKeysAndJWKS(t *testing.T) {
	for _, bad := range []string{"", "k1", "k1:zz", "k1:" + strings.Repeat("ab", 31), "k1:" + strings.Repeat("ab", 32) + ",k1:" + strings.Repeat("cd", 32)} {
		if _, err := ParseSigningKeys(bad); err == nil {
			t.Errorf("ParseSigningKeys(%q) succeeded", bad)
		}
	}
	k := key(t, "2026-10", strings.Repeat("ab", 32))
	jwks := NewTokenManager([]SigningKey{k}, "i", "a", time.Minute).JWKS()
	pub := k.Private.Public().(ed25519.PublicKey)
	if len(jwks) != 1 || jwks[0].Kty != "OKP" || jwks[0].Crv != "Ed25519" || jwks[0].Kid != "2026-10" ||
		jwks[0].X != base64.RawURLEncoding.EncodeToString(pub) {
		t.Errorf("JWKS = %+v", jwks)
	}
}

// ── TOTP, codes de secours, CSRF ────────────────────────────────────────────

func TestTOTPRFC6238Vectors(t *testing.T) {
	// RFC 6238 annexe B, SHA1, secret ASCII « 12345678901234567890 », codes à 8 chiffres.
	secret := []byte("12345678901234567890")
	vectors := map[int64]string{
		59: "94287082", 1111111109: "07081804", 1111111111: "14050471",
		1234567890: "89005924", 2000000000: "69279037", 20000000000: "65353130",
	}
	for ts, want := range vectors {
		if got := hotp(secret, uint64(ts)/30, 8); got != want { //nolint:gosec // ts > 0
			t.Errorf("T=%d: %s, want %s", ts, got, want)
		}
		if got := TOTPCode(secret, time.Unix(ts, 0)); got != want[2:] {
			t.Errorf("T=%d (6 digits): %s, want %s", ts, got, want[2:])
		}
	}
}

func TestVerifyTOTPWindow(t *testing.T) {
	secret := NewTOTPSecret()
	now := time.Unix(1_800_000_015, 0)
	code := TOTPCode(secret, now)
	for _, offset := range []time.Duration{-30 * time.Second, 0, 30 * time.Second} {
		if _, ok := VerifyTOTP(secret, code, now.Add(offset)); !ok {
			t.Errorf("code rejected at offset %s", offset)
		}
	}
	if _, ok := VerifyTOTP(secret, code, now.Add(90*time.Second)); ok {
		t.Error("code accepted 3 steps later")
	}
	if _, ok := VerifyTOTP(secret, "12345", now); ok {
		t.Error("5-digit code accepted")
	}
	spaced := code[:3] + " " + code[3:]
	if step, ok := VerifyTOTP(secret, spaced, now); !ok || step != now.Unix()/30 {
		t.Errorf("spaced code: step=%d ok=%v", step, ok)
	}
}

func TestTOTPURI(t *testing.T) {
	secret := []byte("12345678901234567890")
	u, err := url.Parse(TOTPURI(secret, "admin@gostation.bj"))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if u.Scheme != "otpauth" || u.Host != "totp" || u.Path != "/GoStation:admin@gostation.bj" ||
		q.Get("secret") != "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" || q.Get("issuer") != "GoStation" || q.Get("digits") != "6" {
		t.Errorf("URI = %s", u)
	}
}

func TestRecoveryCodes(t *testing.T) {
	codes := NewRecoveryCodes()
	format := regexp.MustCompile(`^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$`)
	seen := map[string]bool{}
	for _, c := range codes {
		if !format.MatchString(c) || seen[c] {
			t.Errorf("bad or duplicate code %q", c)
		}
		seen[c] = true
	}
	if len(codes) != RecoveryCodeCount {
		t.Fatalf("%d codes, want %d", len(codes), RecoveryCodeCount)
	}
	normalized := strings.ToLower(strings.ReplaceAll(codes[0], "-", " "))
	if hex.EncodeToString(HashRecoveryCode(normalized)) != hex.EncodeToString(HashRecoveryCode(codes[0])) {
		t.Error("recovery code hashing must ignore case, spaces and dashes")
	}
}

func TestCSRF(t *testing.T) {
	k := []byte("0123456789abcdef0123456789abcdef")
	tok := CSRFToken(k, "session-a")
	if !ValidCSRF(k, "session-a", tok) {
		t.Fatal("valid token rejected")
	}
	if ValidCSRF(k, "session-b", tok) || ValidCSRF(k, "session-a", "") || ValidCSRF([]byte("other-key-other-key-other-key-00"), "session-a", tok) {
		t.Fatal("CSRF token must be bound to the session and the key")
	}
}

// ── Validation des champs ───────────────────────────────────────────────────

func TestValidators(t *testing.T) {
	v := &validator{}
	if got := v.phone("phone", "+229 01 90 00 00 00"); got != "+2290190000000" {
		t.Errorf("phone normalized to %q", got)
	}
	if got := v.rccm("rccm", "  rb/cot/24   b 12345 "); got != "RB/COT/24 B 12345" {
		t.Errorf("rccm normalized to %q", got)
	}
	v.ifu("ifu", "3201234567890")
	v.email("email", "afi.dossou@example.bj")
	if err := v.err(); err != nil {
		t.Fatalf("valid inputs rejected: %v", err)
	}

	bad := &validator{}
	bad.phone("phone", "0190000000")
	bad.ifu("ifu", "32012345678")
	bad.email("email", "Afi <afi@example.bj>")
	bad.email("email2", "afi@localhost")
	bad.rccm("rccm", "??")
	bad.text("name", "  ", 1, 10)
	e, ok := apperr.As(bad.err())
	if !ok || len(e.Fields) != 6 {
		t.Fatalf("expected 6 field errors, got %v", bad.err())
	}
}
