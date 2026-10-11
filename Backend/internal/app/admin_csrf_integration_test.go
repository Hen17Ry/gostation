//go:build integration

package app_test

import (
	"net/http"
	"testing"

	"gostation/backend/internal/http/handler"
)

// Après un rechargement de page, l'admin web récupère son jeton CSRF : par le cookie d'accès, ou,
// s'il a expiré, par le cookie de refresh (sans le consommer). Jamais pour un Bearer.
func TestCSRFTokenAfterReload(t *testing.T) {
	admin := adminClient(t)
	names := handler.Cookies{Secure: it.cfg.Auth.CookieSecure}
	var got struct {
		CSRFToken string `json:"csrfToken"`
	}
	r := admin.do(http.MethodGet, "/api/v1/auth/csrf", nil)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &got)
	if got.CSRFToken != admin.csrf || r.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("csrf = %q (Cache-Control %q), want the session token", got.CSRFToken, r.Header().Get("Cache-Control"))
	}

	// Rechargement : le jeton en mémoire est perdu, celui de /auth/csrf suffit pour écrire.
	admin.csrf = got.CSRFToken
	expect(t, admin.do(http.MethodPost, "/api/v1/admin/exports", map[string]any{"dataset": "stations"}), http.StatusAccepted, "")

	// Cookie d'accès expiré : le cookie de refresh identifie la session, sans rotation.
	delete(admin.cookies, names.Access())
	got.CSRFToken = ""
	r = admin.do(http.MethodGet, "/api/v1/auth/csrf", nil)
	expect(t, r, http.StatusOK, "")
	r.decode(t, &got)
	if got.CSRFToken != admin.csrf {
		t.Fatalf("csrf via refresh cookie = %q, want %q", got.CSRFToken, admin.csrf)
	}
	expect(t, admin.do(http.MethodPost, "/api/v1/auth/refresh", nil), http.StatusOK, "")

	expect(t, newClient(t).do(http.MethodGet, "/api/v1/auth/csrf", nil), http.StatusUnauthorized, "auth.unauthorized")
	u, _, _ := verifiedUser(t)
	expect(t, u.do(http.MethodGet, "/api/v1/auth/csrf", nil), http.StatusUnauthorized, "auth.unauthorized")
}
