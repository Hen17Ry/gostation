package auth

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// SigningKey est une clé Ed25519 identifiée par son kid.
type SigningKey struct {
	ID      string
	Private ed25519.PrivateKey
}

// ParseSigningKeys lit JWT_SIGNING_KEYS : « kid:graine_hex[,kid:graine_hex…] ». La première clé
// signe ; toutes vérifient. Rotation : ajouter la nouvelle clé en tête, retirer l'ancienne après
// la durée de vie d'un access token.
func ParseSigningKeys(raw string) ([]SigningKey, error) {
	var keys []SigningKey
	seen := map[string]bool{}
	for item := range strings.SplitSeq(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		kid, seedHex, ok := strings.Cut(item, ":")
		if !ok || kid == "" || seen[kid] {
			return nil, errors.New("each key must be kid:hexseed with a unique kid")
		}
		seed, err := hex.DecodeString(seedHex)
		if err != nil || len(seed) != ed25519.SeedSize {
			return nil, fmt.Errorf("key %q: seed must be %d bytes of hex", kid, ed25519.SeedSize)
		}
		seen[kid] = true
		keys = append(keys, SigningKey{ID: kid, Private: ed25519.NewKeyFromSeed(seed)})
	}
	if len(keys) == 0 {
		return nil, errors.New("at least one signing key is required")
	}
	return keys, nil
}

// Claims sont les revendications de l'access token.
type Claims struct {
	jwt.RegisteredClaims
	Role string `json:"role"`
	// SID identifie la session (famille de refresh tokens) : la révoquer invalide le token.
	SID string `json:"sid"`
	// MFA vaut true pour les sessions admin ouvertes après la 2FA.
	MFA bool `json:"mfa,omitempty"`
}

// UserID renvoie le sujet du token.
func (c *Claims) UserID() (uuid.UUID, error) { return uuid.Parse(c.Subject) }

// TokenManager signe et vérifie les access tokens.
type TokenManager struct {
	keys     []SigningKey
	byID     map[string]ed25519.PublicKey
	issuer   string
	audience string
	ttl      time.Duration
	now      func() time.Time
}

// NewTokenManager construit le gestionnaire de tokens.
func NewTokenManager(keys []SigningKey, issuer, audience string, ttl time.Duration) *TokenManager {
	byID := make(map[string]ed25519.PublicKey, len(keys))
	for _, k := range keys {
		byID[k.ID] = k.Private.Public().(ed25519.PublicKey)
	}
	return &TokenManager{keys: keys, byID: byID, issuer: issuer, audience: audience, ttl: ttl, now: time.Now}
}

// TTL est la durée de vie des access tokens.
func (m *TokenManager) TTL() time.Duration { return m.ttl }

// Issue signe un access token pour la session.
func (m *TokenManager) Issue(userID uuid.UUID, role, sessionID string, mfa bool) (string, error) {
	now := m.now()
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    m.issuer,
			Subject:   userID.String(),
			Audience:  jwt.ClaimStrings{m.audience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(m.ttl)),
			ID:        uuid.NewString(),
		},
		Role: role,
		SID:  sessionID,
		MFA:  mfa,
	}
	t := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	t.Header["kid"] = m.keys[0].ID
	signed, err := t.SignedString(m.keys[0].Private)
	if err != nil {
		return "", fmt.Errorf("auth: sign access token: %w", err)
	}
	return signed, nil
}

// ErrInvalidToken couvre toute erreur de vérification (signature, expiration, audience…).
var ErrInvalidToken = errors.New("auth: invalid access token")

// Verify vérifie l'algorithme (EdDSA uniquement), la clé (kid), l'émetteur, l'audience
// et l'expiration.
func (m *TokenManager) Verify(token string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		key, ok := m.byID[kid]
		if !ok {
			return nil, fmt.Errorf("unknown kid %q", kid)
		}
		return key, nil
	},
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithIssuer(m.issuer),
		jwt.WithAudience(m.audience),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(30*time.Second),
		jwt.WithTimeFunc(m.now),
	)
	if err != nil || claims.SID == "" || claims.Role == "" {
		return nil, ErrInvalidToken
	}
	if _, err := claims.UserID(); err != nil {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// JWK est une clé publique au format JSON Web Key (RFC 8037, OKP/Ed25519).
type JWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
}

// JWKS renvoie les clés publiques de vérification (servies sur /.well-known/jwks.json).
func (m *TokenManager) JWKS() []JWK {
	out := make([]JWK, 0, len(m.keys))
	for _, k := range m.keys {
		out = append(out, JWK{
			Kty: "OKP", Crv: "Ed25519", Use: "sig", Alg: "EdDSA", Kid: k.ID,
			X: base64.RawURLEncoding.EncodeToString(m.byID[k.ID]),
		})
	}
	return out
}
