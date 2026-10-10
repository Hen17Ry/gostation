// Package crypto regroupe les primitives de chiffrement de l'application :
//   - Envelope : chiffrement par enveloppe (une clé AES-256-GCM aléatoire par objet, la DEK,
//     elle-même chiffrée par la clé maître KEK) pour les justificatifs IFU ;
//   - Sealer : chiffrement AES-256-GCM direct de petits secrets (secret TOTP) ;
//   - DeriveKey : sous-clés HKDF-SHA256 dérivées d'un secret maître (APP_SECRET).
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
)

// KeySize est la taille des clés AES-256 (octets).
const KeySize = 32

// ErrDecrypt signale un texte chiffré corrompu, altéré ou une mauvaise clé.
var ErrDecrypt = errors.New("crypto: decryption failed")

// DeriveKey dérive une sous-clé de 32 octets d'un secret maître, séparée par info
// (une valeur d'info par usage : « otp-hmac », « totp-encryption », « csrf »…).
func DeriveKey(master []byte, info string) ([]byte, error) {
	if len(master) < KeySize {
		return nil, fmt.Errorf("crypto: master secret must be at least %d bytes", KeySize)
	}
	return hkdf.Key(sha256.New, master, nil, info, KeySize)
}

func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != KeySize {
		return nil, fmt.Errorf("crypto: key must be %d bytes, got %d", KeySize, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("crypto: %w", err)
	}
	return cipher.NewGCM(block)
}

// seal renvoie nonce || ciphertext.
func seal(aead cipher.AEAD, plaintext, aad []byte) []byte {
	nonce := make([]byte, aead.NonceSize(), aead.NonceSize()+len(plaintext)+aead.Overhead())
	_, _ = rand.Read(nonce) // crypto/rand.Read ne renvoie jamais d'erreur (Go ≥ 1.24)
	return aead.Seal(nonce, nonce, plaintext, aad)
}

func open(aead cipher.AEAD, sealed, aad []byte) ([]byte, error) {
	if len(sealed) < aead.NonceSize()+aead.Overhead() {
		return nil, ErrDecrypt
	}
	nonce, ct := sealed[:aead.NonceSize()], sealed[aead.NonceSize():]
	pt, err := aead.Open(nil, nonce, ct, aad)
	if err != nil {
		return nil, ErrDecrypt
	}
	return pt, nil
}

// Sealer chiffre de petits secrets avec une clé fixe (AES-256-GCM, nonce aléatoire).
type Sealer struct {
	aead cipher.AEAD
}

// NewSealer construit un Sealer sur une clé de 32 octets.
func NewSealer(key []byte) (*Sealer, error) {
	aead, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	return &Sealer{aead: aead}, nil
}

// Seal chiffre plaintext ; aad lie le texte chiffré à son contexte (ex. l'ID utilisateur).
func (s *Sealer) Seal(plaintext, aad []byte) []byte { return seal(s.aead, plaintext, aad) }

// Open déchiffre un texte produit par Seal avec le même aad.
func (s *Sealer) Open(sealed, aad []byte) ([]byte, error) { return open(s.aead, sealed, aad) }

// kekVersion préfixe chaque DEK chiffrée : il permettra la rotation de la KEK
// (plusieurs clés maîtres identifiées par leur version).
const kekVersion byte = 1

// Envelope chiffre des objets avec une DEK aléatoire par objet, chiffrée par la KEK.
type Envelope struct {
	kek cipher.AEAD
}

// NewEnvelope construit l'enveloppe sur la clé maître (32 octets).
func NewEnvelope(kek []byte) (*Envelope, error) {
	aead, err := newGCM(kek)
	if err != nil {
		return nil, err
	}
	return &Envelope{kek: aead}, nil
}

// Seal chiffre plaintext avec une DEK neuve. Renvoie le texte chiffré (nonce || ct) et la
// DEK chiffrée (version || nonce || ct). aad lie les deux à l'objet (ex. sa clé de stockage).
func (e *Envelope) Seal(plaintext, aad []byte) (ciphertext, wrappedKey []byte, err error) {
	dek := make([]byte, KeySize)
	_, _ = rand.Read(dek)
	aead, err := newGCM(dek)
	if err != nil {
		return nil, nil, err
	}
	ciphertext = seal(aead, plaintext, aad)
	wrappedKey = append([]byte{kekVersion}, seal(e.kek, dek, aad)...)
	clear(dek)
	return ciphertext, wrappedKey, nil
}

// Open déchiffre un objet produit par Seal.
func (e *Envelope) Open(ciphertext, wrappedKey, aad []byte) ([]byte, error) {
	if len(wrappedKey) == 0 || wrappedKey[0] != kekVersion {
		return nil, ErrDecrypt
	}
	dek, err := open(e.kek, wrappedKey[1:], aad)
	if err != nil {
		return nil, err
	}
	defer clear(dek)
	aead, err := newGCM(dek)
	if err != nil {
		return nil, ErrDecrypt
	}
	return open(aead, ciphertext, aad)
}
