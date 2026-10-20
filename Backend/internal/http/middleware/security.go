package middleware

import "net/http"

// SecurityHeaders pose les en-têtes de sécurité de l'API sur toutes les réponses, erreurs comprises.
// L'API ne sert que du JSON (et des fichiers téléchargés par fetch) : rien ne doit s'y exécuter,
// s'y encadrer ni être deviné par le navigateur.
//   - HSTS (2 ans, sous-domaines) : ignoré en HTTP clair, donc sans effet en développement ;
//   - nosniff : le Content-Type déclaré fait foi ;
//   - no-referrer : aucune URL (identifiants, filtres) ne fuit vers un tiers ;
//   - CSP default-src 'none' et frame-ancestors 'none' (doublée de X-Frame-Options) : une réponse
//     ouverte directement n'exécute rien et ne peut pas être encadrée ;
//   - CORP same-site : lisible par l'admin (admin.<domaine>, même site, D43), pas par un autre site.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cross-Origin-Resource-Policy", "same-site")
		next.ServeHTTP(w, r)
	})
}
