# Analyses de sécurité automatisées

> Relevé du 2026-10-20 (étape 10B, branche `feat/hardening`). Les mêmes analyses tournent en CI (`.github/workflows/`) : govulncheck à chaque modification du backend, gitleaks et trivy à chaque push. Règle : tout ce qui est **critique ou élevé** est corrigé ; ce qui ne peut pas l'être est justifié ici.

## Synthèse

| Outil | Périmètre | Résultat | Action |
|---|---|---|---|
| govulncheck v1.9.0 | `Backend/` (`./...`, avec et sans le tag `integration`) | 0 vulnérabilité atteinte par le code | `github.com/moby/sys/user` 0.4.0 → 0.4.1 (GO-2026-6686, dépendance des tests via testcontainers) ; GO-2026-5932 non corrigible (voir plus bas) |
| trivy v0.76.0 (`fs`) | Lockfiles (`go.sum`, `package-lock.json`), failles corrigées en amont | 1 élevée : `github.com/moby/go-archive` 0.2.0 (CVE-2026-17106, tests seulement, non appelée donc absente de govulncheck) | 0.2.0 → 0.3.0 ; la CI échoue désormais sur toute faille haute corrigée en amont |
| gosec (dernière version) | `Backend/`, hors code généré | 8 alertes, toutes des faux positifs déjà justifiés par un `//nolint:gosec` commenté | Aucune (détail plus bas) ; golangci-lint (gosec compris) : 0 problème |
| npm audit | `Web/` | 0 | — |
| npm audit | `Mobile/` | 77 (56 élevées, 21 modérées), issues de 6 paquets d'outillage | Aucune correction publiée pour les 2 élevées ; aucune ne part dans l'APK (détail plus bas) |
| gitleaks v8.30.1 | Tout l'historique git (110 commits) | 2 alertes : mots de passe de comptes jetables d'un test d'intégration | Ignorées par empreinte (`.gitleaksignore`) ; 0 fuite réelle |
| trivy v0.76.0 | Images Docker (HIGH, CRITICAL) | `gostation-api` : 0 ; `redis:8.10.2-alpine` : 0 ; Mailpit 1.31.6 : 0 ; PostGIS, OSRM, asynqmon : voir plus bas | Mailpit 1.31.4 → 1.31.6 (4 élevées corrigées) ; PostGIS re-téléchargé (186 → 126) |

## govulncheck

- **GO-2026-5932** (`golang.org/x/crypto/openpgp`, paquet abandonné) : aucune version corrigée ; le module est requis pour `argon2`, `hkdf` et `ssh` mais le paquet `openpgp` n'est ni importé ni appelé. Sans effet.

## gosec

gosec seul ignore les `//nolint:gosec` que golangci-lint respecte. Les 8 alertes :

| Règle | Emplacement | Pourquoi ce n'est pas un défaut |
|---|---|---|
| G101 ×3 | `internal/auth/errors.go:18-22` | Codes d'erreur stables (`auth.invalid_mfa_token`…), pas des secrets |
| G404 ×3 | `internal/jobs/jobs.go:188`, `cmd/seed/main.go:127,141` | Aléa du backoff des tâches et des données fictives de dev : aucun usage cryptographique (les secrets, codes et tokens utilisent `crypto/rand`) |
| G304 | `internal/platform/storage/storage.go:96` | Chemin validé par `Local.path` (clé relative, pas de `..`, racine fixe) |
| G505 | `internal/auth/totp.go:6` | HMAC-SHA1 imposé par la RFC 6238 (TOTP), compris par toutes les applis d'authentification ; HMAC-SHA1 reste sûr |

## npm audit (Mobile)

Les 77 alertes remontent à 6 paquets transitifs. `npm audit fix --force` proposerait des retours en arrière impossibles (Expo 44, React Native 0.72) : rien n'est appliqué.

| Paquet (version) | Gravité | Chemin | Exposition | Correction |
|---|---|---|---|---|
| `braces` 3.0.3 (GHSA-vfj7-8cjw-p6xm, déni de service par motifs imbriqués) | Élevée | `tailwindcss` 3, Metro, Jest (via `micromatch`, `chokidar`, `fast-glob`) | Outillage de build et de test : les motifs viennent de nos fichiers de configuration, jamais d'un tiers ; absent de l'APK | Aucune version corrigée publiée (3.0.3 est la dernière) |
| `node-forge` 1.4.0 (GHSA-86w9-cpqp-85rv, vérification de signature RSA PKCS#1 v1.5) | Élevée | `@expo/cli`, `@expo/code-signing-certificates` | CLI Expo sur le poste de dev ; nous n'utilisons pas la signature des mises à jour EAS ; absent de l'APK | Aucune version corrigée publiée (1.4.0 est la dernière) |
| `decode-uri-component` 0.2.2 (GHSA-vcc3-ghjq-m6fr) | Modérée | `expo-router` → `query-string` 7 | Dans l'app : décodage des liens profonds de l'app elle-même ; au pire un gel local | 0.5.0 est ESM seulement, incompatible avec `query-string` 7 ; à revoir avec la prochaine version d'Expo Router |
| `postcss-selector-parser` 6.1.4 (GHSA-rj75-hqrm-r3gf) | Modérée | `tailwindcss` 3 (NativeWind 4) | Compilation des classes, sur nos fichiers | 7.x incompatible avec Tailwind 3 (NativeWind 4 l'impose) |
| `sprintf-js` 1.0.3 (GHSA-hp3w-g68c-fv3c) | Modérée | `jest-expo` → `js-yaml` 3 → `argparse` 1 | Tests uniquement | Aucune version corrigée publiée |
| `uuid` 7.0.3 (GHSA-w5hq-g745-h8pq) | Modérée | `@expo/config-plugins` → `xcode` | Prebuild iOS ; le défaut ne touche que l'appel avec un tampon fourni, que `xcode` ne fait pas | Montée majeure à faire par Expo |

À revoir à chaque montée de version d'Expo (`npm audit` dans `Mobile/`).

## trivy (images Docker)

| Image | Rôle | HIGH / CRITICAL | Corrigibles | Décision |
|---|---|---|---|---|
| `gostation-api` (distroless, Go 1.27.2) | API et worker | 0 / 0 | — | — |
| `redis:8.10.2-alpine` | Prod et dev | 0 / 0 | — | — |
| `axllent/mailpit:v1.31.6` | Dev seulement | 0 / 0 | — | Mise à jour depuis 1.31.4 (4 élevées dans le binaire) |
| `postgis/postgis:18-3.6` (Debian 13) | Prod et dev | 120 / 6 | 25, toutes dans `gosu` (bibliothèque standard Go) | `gosu` ne sert qu'à quitter root au démarrage, sans entrée externe ; le reste attend des correctifs Debian. Port jamais exposé en prod ; image re-téléchargée à chaque mise à jour (`docs/DEPLOY.md`) |
| `ghcr.io/project-osrm/osrm-backend:v26.10.0-debian` | Prod et dev | 46 / 0 | 3 (paquets Debian) | Service interne (aucun port publié en prod, appelé seulement par l'API) ; image amont, à remplacer à la prochaine version |
| `hibiken/asynqmon:0.7.2` | Dev seulement (profil `dev`, `127.0.0.1`) | 39 / 4 | 43 (Go et dépendances du binaire) | Dernière version publiée ; absente de la prod |

Rapports complets : `var/trivy/*.json` (non versionnés), régénérés par la CI.
