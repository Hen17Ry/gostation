// Package pseudonym remplace l'identifiant d'un compte par un pseudonyme stable (HMAC-SHA-256 avec
// une sous-clé d'APP_SECRET) : on repère les auteurs récurrents d'un signalement sans exposer leur
// compte. Les exports admin et la pseudonymisation des signalements (90 jours, étape 10A)
// partagent la même clé : un même auteur garde le même pseudonyme.
package pseudonym

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"

	"github.com/google/uuid"
)

// Of renvoie le pseudonyme du compte id (« u_ » et 16 caractères hexadécimaux).
func Of(key []byte, id uuid.UUID) string {
	m := hmac.New(sha256.New, key)
	m.Write(id[:])
	return "u_" + hex.EncodeToString(m.Sum(nil))[:16]
}
