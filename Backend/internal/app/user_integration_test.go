//go:build integration

package app_test

import (
	"net/http"
	"strings"
	"testing"

	"gostation/backend/internal/apperr"
	"gostation/backend/internal/auth"
)

// Parcours complet : inscription → vérification → login → refresh → rotation →
// réutilisation détectée → logout.
func TestUserJourney(t *testing.T) {
	c := newClient(t)
	email := uniqueEmail("afi")

	reg := registerUser(t, c, email)
	if reg.AccessToken == "" || !strings.HasPrefix(reg.RefreshToken, "gsr_") || reg.ExpiresIn != 900 ||
		reg.User.Role != "user" || reg.User.EmailVerified {
		t.Fatalf("register response = %+v", reg)
	}

	// Vérification : mauvais code refusé, bon code accepté.
	code := latestCode(t, email, "Confirmez votre adresse")
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	expect(t, c.do(http.MethodPost, "/api/v1/auth/verify-email", map[string]string{"email": email, "code": wrong}), http.StatusBadRequest, auth.CodeInvalidCode)
	expect(t, c.do(http.MethodPost, "/api/v1/auth/verify-email", map[string]string{"email": email, "code": code}), http.StatusNoContent, "")

	c.bearer = reg.AccessToken
	var me struct {
		EmailVerified bool `json:"emailVerified"`
		PrivacyPolicy struct {
			AcceptedVersion  string `json:"acceptedVersion"`
			ReacceptRequired bool   `json:"reacceptRequired"`
		} `json:"privacyPolicy"`
	}
	c.do(http.MethodGet, "/api/v1/me", nil).decode(t, &me)
	if !me.EmailVerified || me.PrivacyPolicy.AcceptedVersion != "1.0" || me.PrivacyPolicy.ReacceptRequired {
		t.Fatalf("/me after verification = %+v", me)
	}

	// Nouvelle connexion, puis rotation du refresh token.
	device := newClient(t)
	s := login(t, device, email, password)
	r := device.do(http.MethodPost, "/api/v1/auth/refresh", map[string]string{"refreshToken": s.RefreshToken})
	expect(t, r, http.StatusOK, "")
	var rotated session
	r.decode(t, &rotated)
	if rotated.RefreshToken == s.RefreshToken || rotated.AccessToken == "" {
		t.Fatalf("refresh did not rotate: %+v", rotated)
	}

	// Réutilisation de l'ancien refresh token : la session entière est révoquée.
	expect(t, device.do(http.MethodPost, "/api/v1/auth/refresh", map[string]string{"refreshToken": s.RefreshToken}), http.StatusUnauthorized, auth.CodeInvalidRefreshToken)
	expect(t, device.do(http.MethodPost, "/api/v1/auth/refresh", map[string]string{"refreshToken": rotated.RefreshToken}), http.StatusUnauthorized, auth.CodeInvalidRefreshToken)
	device.bearer = rotated.AccessToken
	expect(t, device.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, apperr.CodeUnauthorized)
	// L'autre session (celle de l'inscription) n'est pas touchée.
	expect(t, c.do(http.MethodGet, "/api/v1/me", nil), http.StatusOK, "")

	// Logout : l'access token de la session devient inutilisable immédiatement.
	expect(t, c.do(http.MethodPost, "/api/v1/auth/logout", nil), http.StatusNoContent, "")
	expect(t, c.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, apperr.CodeUnauthorized)
	expect(t, c.do(http.MethodPost, "/api/v1/auth/refresh", map[string]string{"refreshToken": reg.RefreshToken}), http.StatusUnauthorized, auth.CodeInvalidRefreshToken)

	actions := auditActions(t, "user", reg.User.ID)
	if !contains(actions, "user.registered", "auth.email_verified", "auth.login_succeeded") {
		t.Errorf("audit for user = %v", actions)
	}
}

func TestRegisterValidation(t *testing.T) {
	c := newClient(t)
	email := uniqueEmail("val")
	weak := c.do(http.MethodPost, "/api/v1/auth/register", map[string]string{
		"firstName": "", "lastName": "D", "email": "not-an-email", "password": "password123", "privacyPolicyVersion": "0.9",
	})
	expect(t, weak, http.StatusUnprocessableEntity, apperr.CodeValidation)
	var p struct {
		Errors []apperr.FieldError `json:"errors"`
	}
	weak.decode(t, &p)
	got := map[string]string{}
	for _, f := range p.Errors {
		got[f.Field] = f.Code
	}
	for field, code := range map[string]string{"firstName": "required", "email": "invalid", "password": "too_common", "privacyPolicyVersion": "outdated"} {
		if got[field] != code {
			t.Errorf("field %s: %q, want %q (all: %v)", field, got[field], code, got)
		}
	}

	registerUser(t, c, email)
	dup := c.do(http.MethodPost, "/api/v1/auth/register", map[string]string{
		"firstName": "Afi", "lastName": "Dossou", "email": strings.ToUpper(email), "password": password, "privacyPolicyVersion": "1.0",
	})
	expect(t, dup, http.StatusConflict, auth.CodeEmailTaken)
}

// Messages génériques : email inconnu, mauvais mot de passe et compte admin sur le login
// mobile donnent exactement la même réponse.
func TestLoginAntiEnumeration(t *testing.T) {
	c := newClient(t)
	email := uniqueEmail("enum")
	registerUser(t, c, email)
	adminEmail := uniqueEmail("admin-enum")
	if _, err := it.svc.Auth.CreateAdmin(t.Context(), adminEmail, "Ada", "Admin", password); err != nil {
		t.Fatal(err)
	}

	var bodies []string
	for _, creds := range [][2]string{{uniqueEmail("ghost"), password}, {email, "Wrong-Password-1"}, {adminEmail, password}} {
		r := newClient(t).do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": creds[0], "password": creds[1]})
		expect(t, r, http.StatusUnauthorized, auth.CodeInvalidCredentials)
		var p map[string]any
		r.decode(t, &p)
		delete(p, "requestId")
		bodies = append(bodies, strings.TrimSpace(mustJSON(t, p)))
	}
	if bodies[0] != bodies[1] || bodies[1] != bodies[2] {
		t.Fatalf("login failures must be indistinguishable:\n%s", strings.Join(bodies, "\n"))
	}

	// Forgot et resend : même réponse que le compte existe ou non.
	for _, path := range []string{"/api/v1/auth/password/forgot", "/api/v1/auth/resend-verification"} {
		known := newClient(t).do(http.MethodPost, path, map[string]string{"email": email})
		unknown := newClient(t).do(http.MethodPost, path, map[string]string{"email": uniqueEmail("nobody")})
		if known.Code != http.StatusAccepted || unknown.Code != known.Code || known.Body.String() != unknown.Body.String() {
			t.Errorf("%s: known=%d %s unknown=%d %s", path, known.Code, known.Body, unknown.Code, unknown.Body)
		}
	}
}

func TestLoginRateLimits(t *testing.T) {
	email := uniqueEmail("rl")
	registerUser(t, newClient(t), email)

	// Par IP : 5 essais par minute.
	c := newClient(t)
	for range 5 {
		expect(t, c.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": uniqueEmail("x"), "password": "nope-nope"}), http.StatusUnauthorized, "")
	}
	r := c.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": password})
	expect(t, r, http.StatusTooManyRequests, apperr.CodeRateLimited)
	if r.Header().Get("Retry-After") == "" {
		t.Error("429 without Retry-After")
	}

	// Par email : 5 essais par minute, quelle que soit l'IP.
	for range 5 {
		newClient(t).do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": "Wrong-Password-1"})
	}
	expect(t, newClient(t).do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": password}), http.StatusTooManyRequests, apperr.CodeRateLimited)
}

func TestRegisterRateLimit(t *testing.T) {
	c := newClient(t)
	for range 10 {
		registerUser(t, c, uniqueEmail("burst"))
	}
	r := c.do(http.MethodPost, "/api/v1/auth/register", map[string]string{
		"firstName": "A", "lastName": "B", "email": uniqueEmail("burst"), "password": password, "privacyPolicyVersion": "1.0",
	})
	expect(t, r, http.StatusTooManyRequests, apperr.CodeRateLimited)
}

func TestVerificationCodeAttemptsAndResend(t *testing.T) {
	c := newClient(t)
	email := uniqueEmail("otp")
	registerUser(t, c, email)
	code := latestCode(t, email, "Confirmez votre adresse")

	// Renvoi immédiat : réponse générique, mais aucun nouvel email (1 par minute).
	expect(t, c.do(http.MethodPost, "/api/v1/auth/resend-verification", map[string]string{"email": email}), http.StatusAccepted, "")
	if msgs, _ := it.mailpit.Messages(t.Context(), email); len(msgs) != 1 {
		t.Fatalf("%d emails after an immediate resend, want 1", len(msgs))
	}

	wrong := "000000"
	if wrong == code {
		wrong = "111111"
	}
	for range auth.OTPMaxAttempts {
		expect(t, c.do(http.MethodPost, "/api/v1/auth/verify-email", map[string]string{"email": email, "code": wrong}), http.StatusBadRequest, auth.CodeInvalidCode)
	}
	// Après 5 échecs, le code est détruit : le bon code ne passe plus.
	expect(t, c.do(http.MethodPost, "/api/v1/auth/verify-email", map[string]string{"email": email, "code": code}), http.StatusBadRequest, auth.CodeInvalidCode)
}

func TestPasswordResetFlow(t *testing.T) {
	email := uniqueEmail("reset")
	phone := newClient(t)
	s := registerUser(t, phone, email)
	phone.bearer = s.AccessToken

	c := newClient(t)
	expect(t, c.do(http.MethodPost, "/api/v1/auth/password/forgot", map[string]string{"email": email}), http.StatusAccepted, "")
	code := latestCode(t, email, "Réinitialisation")

	expect(t, c.do(http.MethodPost, "/api/v1/auth/password/reset", map[string]string{"email": email, "code": code, "newPassword": "password123"}),
		http.StatusUnprocessableEntity, apperr.CodeValidation)
	expect(t, c.do(http.MethodPost, "/api/v1/auth/password/reset", map[string]string{"email": uniqueEmail("ghost"), "code": code, "newPassword": "Nouveau-Pont-2026"}),
		http.StatusBadRequest, auth.CodeInvalidCode)
	// Le mot de passe refusé n'a pas consommé le code.
	expect(t, c.do(http.MethodPost, "/api/v1/auth/password/reset", map[string]string{"email": email, "code": code, "newPassword": "Nouveau-Pont-2026"}),
		http.StatusNoContent, "")

	expect(t, phone.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, apperr.CodeUnauthorized)
	expect(t, newClient(t).do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": password}), http.StatusUnauthorized, auth.CodeInvalidCredentials)
	ns := login(t, newClient(t), email, "Nouveau-Pont-2026")
	if !ns.User.EmailVerified {
		t.Error("a successful reset proves ownership of the email: it should be marked verified")
	}
	if _, err := it.mailpit.WaitFor(t.Context(), email, "mot de passe a été modifié"); err != nil {
		t.Error(err)
	}
}

func TestChangePasswordAndSessions(t *testing.T) {
	email := uniqueEmail("sess")
	registerUser(t, newClient(t), email)
	a, b, cDev := newClient(t), newClient(t), newClient(t)
	a.bearer = login(t, a, email, password).AccessToken
	b.bearer = login(t, b, email, password).AccessToken
	cDev.bearer = login(t, cDev, email, password).AccessToken

	var list struct {
		Items []struct {
			ID      string `json:"id"`
			Current bool   `json:"current"`
			Client  string `json:"client"`
		} `json:"items"`
	}
	a.do(http.MethodGet, "/api/v1/me/sessions", nil).decode(t, &list)
	if len(list.Items) != 4 { // inscription + 3 connexions
		t.Fatalf("%d sessions, want 4", len(list.Items))
	}
	currents := 0
	for _, s := range list.Items {
		if s.Current {
			currents++
		}
	}
	if currents != 1 {
		t.Errorf("%d sessions flagged current, want 1", currents)
	}

	// Révoquer la session de cDev depuis a.
	var cID string
	cDev.do(http.MethodGet, "/api/v1/me/sessions", nil).decode(t, &list)
	for _, s := range list.Items {
		if s.Current {
			cID = s.ID
		}
	}
	expect(t, a.do(http.MethodDelete, "/api/v1/me/sessions/"+cID, nil), http.StatusNoContent, "")
	expect(t, cDev.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, "")
	// La session d'un autre compte : 404.
	other := newClient(t)
	other.bearer = registerUser(t, other, uniqueEmail("other")).AccessToken
	expect(t, other.do(http.MethodDelete, "/api/v1/me/sessions/"+cID, nil), http.StatusNotFound, apperr.CodeNotFound)

	// Changement de mot de passe depuis a : b est révoquée, a reste connectée.
	expect(t, a.do(http.MethodPost, "/api/v1/me/change-password", map[string]string{"currentPassword": "wrong", "newPassword": "Autre-Lagune-77"}),
		http.StatusUnprocessableEntity, apperr.CodeValidation)
	expect(t, a.do(http.MethodPost, "/api/v1/me/change-password", map[string]string{"currentPassword": password, "newPassword": "Autre-Lagune-77"}),
		http.StatusNoContent, "")
	expect(t, b.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, "")
	expect(t, a.do(http.MethodGet, "/api/v1/me", nil), http.StatusOK, "")

	// logout-all : plus aucune session.
	expect(t, a.do(http.MethodPost, "/api/v1/auth/logout-all", nil), http.StatusNoContent, "")
	expect(t, a.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, "")
}

func TestProfileAndPrivacyPolicy(t *testing.T) {
	c := newClient(t)
	s := registerUser(t, c, uniqueEmail("profile"))
	c.bearer = s.AccessToken

	var me struct {
		FirstName     string `json:"firstName"`
		LastName      string `json:"lastName"`
		PrivacyPolicy struct {
			ReacceptRequired bool `json:"reacceptRequired"`
		} `json:"privacyPolicy"`
	}
	r := c.do(http.MethodPatch, "/api/v1/me", map[string]string{"firstName": "  Afiwa "})
	expect(t, r, http.StatusOK, "")
	r.decode(t, &me)
	if me.FirstName != "Afiwa" || me.LastName != "Dossou" {
		t.Fatalf("profile = %+v", me)
	}
	expect(t, c.do(http.MethodPatch, "/api/v1/me", map[string]string{"role": "admin"}), http.StatusUnprocessableEntity, apperr.CodeValidation)

	// La politique a changé depuis l'acceptation : /me demande une réacceptation.
	if _, err := it.pool.Exec(t.Context(), `UPDATE users SET privacy_policy_version = '0.9' WHERE id = $1`, s.User.ID); err != nil {
		t.Fatal(err)
	}
	c.do(http.MethodGet, "/api/v1/me", nil).decode(t, &me)
	if !me.PrivacyPolicy.ReacceptRequired {
		t.Fatal("reacceptRequired must be true after a policy change")
	}
	expect(t, c.do(http.MethodPost, "/api/v1/me/accept-privacy-policy", map[string]string{"version": "0.9"}), http.StatusUnprocessableEntity, apperr.CodeValidation)
	r = c.do(http.MethodPost, "/api/v1/me/accept-privacy-policy", map[string]string{"version": "1.0"})
	expect(t, r, http.StatusOK, "")
	r.decode(t, &me)
	if me.PrivacyPolicy.ReacceptRequired {
		t.Fatal("reacceptRequired still true after accepting")
	}
}

func TestDeleteAccount(t *testing.T) {
	email := uniqueEmail("delete")
	c := newClient(t)
	s := registerUser(t, c, email)
	c.bearer = s.AccessToken
	other := newClient(t)
	other.bearer = login(t, other, email, password).AccessToken

	expect(t, c.do(http.MethodDelete, "/api/v1/me", map[string]string{"password": "wrong"}), http.StatusUnprocessableEntity, apperr.CodeValidation)
	expect(t, c.do(http.MethodDelete, "/api/v1/me", map[string]string{"password": password}), http.StatusNoContent, "")

	expect(t, c.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, "")
	expect(t, other.do(http.MethodGet, "/api/v1/me", nil), http.StatusUnauthorized, "")
	expect(t, newClient(t).do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": email, "password": password}), http.StatusUnauthorized, auth.CodeInvalidCredentials)

	var gotEmail, first, status string
	if err := it.pool.QueryRow(t.Context(), `SELECT email, first_name, status FROM users WHERE id = $1`, s.User.ID).Scan(&gotEmail, &first, &status); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(gotEmail, "delete.") || first != "Deleted" || status != "pending_deletion" {
		t.Errorf("account not anonymized: %s %s %s", gotEmail, first, status)
	}
	if !contains(auditActions(t, "user", s.User.ID), "user.account_deleted") {
		t.Error("account deletion not audited")
	}
	// Preuve de conformité : une demande de suppression close, et l'email de confirmation.
	if n := queryInt64(t, `SELECT count(*) FROM data_requests WHERE user_id = $1 AND type = 'deletion' AND status = 'completed'`, s.User.ID); n != 1 {
		t.Error("deletion not recorded as a closed data request")
	}
	waitMail(t, email, "Votre compte a été supprimé")
	// L'adresse est de nouveau libre.
	registerUser(t, newClient(t), email)
}

func TestJWKS(t *testing.T) {
	r := newClient(t).do(http.MethodGet, "/.well-known/jwks.json", nil)
	expect(t, r, http.StatusOK, "")
	var jwks struct {
		Keys []auth.JWK `json:"keys"`
	}
	r.decode(t, &jwks)
	if len(jwks.Keys) != 1 || jwks.Keys[0].Kid != "it-key" || jwks.Keys[0].Alg != "EdDSA" {
		t.Fatalf("jwks = %+v", jwks)
	}
}
