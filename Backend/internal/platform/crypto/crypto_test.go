package crypto_test

import (
	"bytes"
	"errors"
	"testing"

	"gostation/backend/internal/platform/crypto"
)

var kek = bytes.Repeat([]byte{7}, crypto.KeySize)

func TestEnvelopeRoundTripAndTampering(t *testing.T) {
	env, err := crypto.NewEnvelope(kek)
	if err != nil {
		t.Fatal(err)
	}
	plain := []byte("%PDF-1.7 attestation IFU")
	aad := []byte("stations/abc/doc.bin")
	ct, wrapped, err := env.Seal(plain, aad)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(ct, plain) {
		t.Fatal("ciphertext contains the plaintext")
	}
	got, err := env.Open(ct, wrapped, aad)
	if err != nil || !bytes.Equal(got, plain) {
		t.Fatalf("Open = %q, %v", got, err)
	}

	ct2, wrapped2, _ := env.Seal(plain, aad)
	if bytes.Equal(ct, ct2) || bytes.Equal(wrapped, wrapped2) {
		t.Fatal("each object must get a fresh data key and nonce")
	}

	flip := func(b []byte) []byte { c := bytes.Clone(b); c[len(c)-1] ^= 1; return c }
	other, _ := crypto.NewEnvelope(bytes.Repeat([]byte{8}, crypto.KeySize))
	cases := map[string]func() ([]byte, error){
		"tampered ciphertext":  func() ([]byte, error) { return env.Open(flip(ct), wrapped, aad) },
		"tampered wrapped key": func() ([]byte, error) { return env.Open(ct, flip(wrapped), aad) },
		"wrong aad":            func() ([]byte, error) { return env.Open(ct, wrapped, []byte("stations/other")) },
		"wrong kek":            func() ([]byte, error) { return other.Open(ct, wrapped, aad) },
		"unknown kek version":  func() ([]byte, error) { w := bytes.Clone(wrapped); w[0] = 9; return env.Open(ct, w, aad) },
		"truncated":            func() ([]byte, error) { return env.Open(ct[:5], wrapped, aad) },
	}
	for name, fn := range cases {
		if _, err := fn(); !errors.Is(err, crypto.ErrDecrypt) {
			t.Errorf("%s: error = %v, want ErrDecrypt", name, err)
		}
	}
}

func TestSealerAndDeriveKey(t *testing.T) {
	k1, err := crypto.DeriveKey(kek, "totp-encryption")
	if err != nil {
		t.Fatal(err)
	}
	k2, _ := crypto.DeriveKey(kek, "csrf")
	again, _ := crypto.DeriveKey(kek, "totp-encryption")
	if bytes.Equal(k1, k2) || !bytes.Equal(k1, again) || len(k1) != crypto.KeySize {
		t.Fatal("DeriveKey must be deterministic and separated by info")
	}
	if _, err := crypto.DeriveKey([]byte("short"), "x"); err == nil {
		t.Fatal("short master secret accepted")
	}

	s, _ := crypto.NewSealer(k1)
	sealed := s.Seal([]byte("JBSWY3DPEHPK3PXP"), []byte("user-1"))
	if got, err := s.Open(sealed, []byte("user-1")); err != nil || string(got) != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("Open = %q, %v", got, err)
	}
	if _, err := s.Open(sealed, []byte("user-2")); !errors.Is(err, crypto.ErrDecrypt) {
		t.Fatal("sealed secret must be bound to its aad")
	}
	if _, err := crypto.NewSealer([]byte("too short")); err == nil {
		t.Fatal("short key accepted")
	}
}
