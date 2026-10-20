# GoStation — État des lieux

> Établi le 2026-10-20 sur `main` @ `7e7ae97`, par lecture du dépôt et exécution des commandes citées, sans modifier le code. Ce qui n'a pas pu être vérifié est signalé (§3, fin).

## 1. Résumé

- Le code de la V1 est écrit de bout en bout : API Go (88 chemins OpenAPI), worker asynq, admin web, app Android (utilisateur, gérant, push), droits des personnes et purges. Étapes 0 à 8 du plan : faites. Étape 9 : à moitié (données personnelles faites ; durcissement de sécurité et déploiement à faire).
- Vérifié aujourd'hui : lint, typecheck et builds sans erreur ; tests Go unitaires et d'intégration verts ; Web 120/120 et Mobile 240/240 quand les suites tournent seules (4 tests dépassent leur délai de 5 s quand elles tournent en même temps).
- Rien n'est déployé : ni hébergeur, ni domaine, ni URL d'API de production (un build `production` appellerait `127.0.0.1`), ni stockage objet, ni SMTP réel, ni sauvegardes, ni CI.
- Textes légaux à l'état de projet (21 mentions « À COMPLÉTER ») ; aucune formalité APDP accomplie.
- **Pas prêt pour une bêta publique.** Une bêta fermée Android est proche : il faut un serveur de staging en HTTPS, l'URL de l'API dans EAS et un SMTP réel, puis l'accord du juriste pour collecter des données réelles avant les formalités APDP.

## 2. Étapes

| # | Étape | État | Commit / branche |
|---|---|---|---|
| 0 | Fondations | ✅ Faite | `fa82529` ; `make check` OK |
| 1 | Socle backend | ✅ Faite | `feat/backend-skeleton` → `31dc06f` |
| 2 | Auth et rôles | ✅ Faite | `feat/auth` → `06266e3` |
| 3 | Stations et stocks | ✅ Faite (historique des stocks du gérant reporté) | `feat/stations` → `eb7f0b5` |
| 4 | Recherche et itinéraire | ✅ Faite | `feat/search` → `b02f694` |
| 5 | Notifications, rappels, signalements, favoris | ✅ Faite | `feat/notifications` → `a963ccc` ; push de décision `c61f7aa` |
| 6 | API admin | ✅ Faite | `feat/admin-api` → `3e4a841` ; compléments `ed2e3ea`, `6e6ccde` |
| 7 | Web admin | ✅ Faite (Lighthouse mobile sous la cible) | `feat/web-admin` → `8d4285a` ; `d8a4739`, `6b0c313` |
| 8 | Mobile : parcours utilisateur, gérant, push, build | 🟡 Android fait ; build `production` inutilisable ; iOS jamais construit | `feat/mobile` → `3770e3c` ; `feat/mobile-manager` → `c345d13` ; `feat/push` → `c298e5e` |
| 9a | Données personnelles (politique, CGU, purges, demandes) | ✅ Code fait ; textes en projet | `feat/privacy` → `7e7ae97` |
| 9b | Sécurité (10B) | ⬜ À faire | — |
| 9c | Tests et performance | 🟡 Tests en place, pas de CI ; perf non mesurée sur la cible | — |
| 9d | Déploiement (10C) | ⬜ À faire | — |

**Git** : 11 branches `feat/*`, toutes fusionnées dans `main` ; aucune branche non fusionnée ; `main` = `origin/main` (`git ls-remote`), arbre de travail propre, aucun stash, aucun tag. `feat/privacy` et `feat/push` n'existent qu'en local, mais leur contenu est dans `main`, donc poussé.

## 3. Ce qui fonctionne (vérifié le 2026-10-20)

| Vérification | Résultat |
|---|---|
| `make lint` | 0 problème (golangci-lint v2.14) |
| `make test` (unitaires + intégration, `-race`, testcontainers) | ✅ 29 paquets OK, 0 échec, 3 min 10 ; 209 fonctions `Test`, 25 fichiers d'intégration |
| Couverture, intégration comprise | `internal/auth` 82,5 %, `internal/search` 86,2 % (objectif ≥ 80 %) |
| Spec OpenAPI | 3.1.0, 88 chemins ; le test qui compare la spec aux routes servies passe ; types Web et Mobile régénérés à part : identiques aux fichiers commités |
| Web `lint`, `typecheck`, `build` | ✅ (avertissement Vite : un chunk de plus de 500 ko, MapLibre, chargé à la demande) |
| Web `check:bundle` | ✅ JS initial de 146,4 Ko gzip (budget 200 Ko) |
| Web `test` | ✅ 120/120 seul ; 1 dépassement de délai (`login-page.test.tsx`) pendant que Jest tournait |
| Mobile `lint`, `typecheck` | ✅ |
| Mobile `test` | ✅ 240/240 seul (39 s) ; 3 dépassements de délai sous charge (`product-picker`, `privacy/screens`, `stocks-screen`) |
| `docker compose ps` | 7 services up et healthy (postgres, redis, osrm, mailpit, asynqmon, api, worker), image `gostation-api:7e7ae97` ; `/readyz` → `ready` |
| `make check` | ✅ PostGIS 3.6, Redis `noeviction`, OSRM `/route` et `/table` à Cotonou |
| `make migrate-status` | 29 migrations appliquées à la base de dev |
| EAS (`eas build:list`) | Projet `@hen_ry/gostation`, Android uniquement : `preview` versionCode 8, 10, 11 ✅ ; `production` 12 et 13 en échec, 14 ✅ (2026-10-16 02:54 UTC) |
| EAS (`eas env:list`) | `development` et `preview` : `EXPO_PUBLIC_API_URL`, `GOOGLE_SERVICES_JSON` ; `production` : `GOOGLE_SERVICES_JSON` seulement |

**Non vérifié** (rien relancé) : E2E Playwright et Maestro, Flashlight, `make bench`, `make bench-stats`, Lighthouse, audit a11y mobile, captures ; identifiants EAS (keystore, clé FCM V1 : `eas credentials` est interactif) ; essai sur téléphone. Les chiffres de performance cités viennent de `Mobile/docs/performance.md`, `Web/docs/design-system.md` §10 et ARCHITECTURE §4.4.

## 4. Ce qui reste à faire

### Bloquant pour la mise en production

1. **Hébergement et domaine** (D4, D43) : serveur, `admin.<domaine>` et `api.<domaine>`, TLS par un reverse proxy, `HTTP_TRUSTED_PROXIES`, `CORS_ALLOWED_ORIGINS`. Le dépôt ne contient aucune configuration de déploiement, de proxy ni de sauvegarde.
2. **URL de l'API dans l'app** : la variable EAS `EXPO_PUBLIC_API_URL` manque dans l'environnement `production`. `src/api/client.ts:14` utilise alors `http://127.0.0.1:8080`, et le HTTP en clair est interdit en release. Il faudra ensuite un nouveau build.
3. **Stockage des fichiers** (justificatifs, exports, copies) : seul le disque local existe (`internal/platform/storage/storage.go:2`, S3 « au déploiement »).
4. **SMTP de production** (TLS imposé en prod, `internal/config/config.go:354`), adresse d'expédition, SPF et DKIM.
5. **Sauvegardes** de la base et des fichiers, avec une durée de rotation à indiquer dans la politique, et une restauration testée.
6. **Juridique** : identité du responsable, réponses du juriste (23 questions), 21 « À COMPLÉTER », formalités APDP F1 à F5, `PRIVACY_CONTACT_EMAIL` (vide dans `.env`).
7. **Google Play** : fiche, « Sécurité des données » (brouillon prêt), URL publique de la politique (`make legal-html`, à héberger), **URL web de suppression de compte (inexistante)**, clé de compte de service pour `eas submit` (`submit.production` vide).
8. **CI** : aucune (`.github/` absent), alors que CLAUDE.md exige une CI verte.

### Important

- **10B** : E1, empreinte d'IP des limiteurs en SHA-256 sans clé (`internal/http/middleware/ratelimit.go:99`) ; E6, aucune purge de `station_location_requests` (absente de `internal/retention`).
- Mesurer la perf sur un Android de 2 à 3 Go (D50) : seuls un Galaxy S10 (8 Go) et un émulateur ont été mesurés.
- Lighthouse mobile de l'admin : connexion 84, tableau de bord 62 (cible ≥ 85).
- Stabiliser les tests sous charge (délais de 5 s) avant de brancher la CI.
- Nettoyer la base de dev : 4 comptes `@example.bj` (2 gérants, 2 utilisateurs, créés les 10 et 11/10) et 2 stations hors seed (« Station Akpakpa », « Station Cadjehoun », `pending`).
- Faire un nouveau build : aucun ne contient « Mes données » ni la réacceptation (`4c8ed67`, 16/10 à 13 h, est postérieur au dernier build).
- Mettre à jour le README (il indique encore « Mobile : à initialiser » et « Backend : socle + auth »).
- E7 : contrat OpenFreeMap ou tuiles auto-hébergées.

### Plus tard

- iOS : aucun build.
- Historique des stocks du gérant (`/manager/station/stocks/history`, marqué « plus tard » dans ARCHITECTURE §5).
- V2 : plusieurs stations par compte et comptes employés (D67), prix (D68), OTP SMS (D6).
- Premier glissement du panneau de résultats à 38-51 fps (piste : worklets en mode bundle) ; réaligner Reanimated et worklets sur la version de l'SDK (D56).

## 5. Écarts par rapport à CLAUDE.md et ARCHITECTURE §9

| Règle ou décision | Constat | Preuve |
|---|---|---|
| « `main` protégée, PR en squash merge, CI verte obligatoire » | Pas de CI ni de PR ; `main` non protégée ; fusions locales en merge commits | `.github/` absent ; `gh pr list` vide ; API GitHub 403 (protection indisponible sur un dépôt privé gratuit) ; `git log --graph` |
| « Base de dev : aucune donnée de test » (CLAUDE.md, D46) | 4 comptes de test et 2 stations restent | `psql` sur la base de dev |
| D77 : URL de production fixée à l'étape 10 | Pas encore | `eas env:list --environment production` |
| D10 : stockage S3 au déploiement | Disque local seulement | `storage.go` |
| D45 : Lighthouse mobile ≥ 85 | 84 et 62 | `Web/docs/design-system.md` §10 |
| D50 : cible Android de 2 à 3 Go | Non mesurée | `Mobile/docs/performance.md` |
| D49 : code compatible iOS | Jamais compilé | `eas build:list` (Android seulement) |
| Inventaire E1 et E6, prévus en 10B | Toujours présents | code cité au §4 |
| Inventaire E2 à E5 et E7 | En attente du juriste | `docs/legal/inventaire-donnees.md` §7 |
| ARCHITECTURE §5 : `stocks/history` | Documenté, non implémenté (reporté) | absent de `openapi.yaml` |
| Spec OpenAPI `info.version` | `0.7.0`, inchangée depuis l'auth (`222131b`) malgré six étapes | `git log -L3,3:Backend/api/openapi.yaml` |

Règles contrôlées **sans écart** : SQL écrit à la main avec sqlc et goose, sans ORM ; tuiles OpenFreeMap uniquement (aucune autre URL de carte) ; secrets hors dépôt (`google-services.json` ignoré, absent de git) ; test des `lat`/`lng` masqués dans les logs présent ; types d'API générés à jour ; budget JS de l'admin respecté.

## 6. Dette technique et risques

- **Tests sensibles à la charge** : Vitest et Jest gardent le délai de 5 s par défaut. Sur cette machine (8 cœurs), 4 échecs quand les suites tournent ensemble, aucun quand elles tournent seules. Une CI sur une petite machine échouerait au hasard.
- **Maestro** : un `retry` sur la saisie du code (clavier Samsung, `e08df8d`) et 5 étapes `optional: true` (démarrage, intro des rappels, captures).
- **Code** : aucun TODO, FIXME ni HACK ; 47 `//nolint`, tous commentés (surtout des conversions d'entiers bornées signalées par gosec).
- **Contournements documentés** : Reanimated et worklets épinglés au-dessus de l'SDK (D56), règle R8 pour le service FCM (D75), `.fingerprintignore` sur un fichier de `node_modules` réécrit par Gradle (D77).
- **Perf mobile** : RAM de 330 à 350 Mo (Flashlight, PSS ≈ 240 Mo) mesurée sur un téléphone de 8 Go, risquée sur 2 Go ; creux à 38-51 fps au premier glissement du panneau.
- **Worker en instance unique** (scheduler intégré) : point de défaillance unique pour les emails, push, rappels et purges.
- **Aucun suivi des plantages** (choix assumé, inventaire §6) : en bêta, les crashs ne remonteront pas.
- **Divers** : 13 images `gostation-api` locales et un conteneur testcontainers orphelin (`great_goodall`, 15/10, jamais démarré).

## 7. Ce qui dépend de vous

| Sujet | État constaté | À faire |
|---|---|---|
| Expo / EAS | Compte `hen_ry`, projet lié (`da725901-…`), `EXPO_ACCESS_TOKEN` renseigné dans `.env` | Variable `EXPO_PUBLIC_API_URL` en `production` ; vérifier keystore et clé FCM V1 (`eas credentials`) |
| Firebase | `GOOGLE_SERVICES_JSON` présent dans les 3 environnements EAS | Rien |
| Google Play | Aucune trace dans le dépôt | Compte développeur, fiche, clé de service pour `eas submit` |
| Apple | Aucun build iOS | Compte Apple Developer, si iOS en V1 |
| Hébergement, domaine | Non choisis (D4, D43) | Choisir (contrainte APDP sur la localisation), réserver le domaine |
| SMTP, stockage objet, sauvegardes | Non choisis | Choisir les fournisseurs |
| Secrets de production | Seuls ceux de dev existent (`make env`) | Les générer chez l'hébergeur ou dans un gestionnaire de secrets |
| Textes juridiques | « PROJET », 21 « À COMPLÉTER » | Identité légale du responsable ; consulter un juriste (`docs/legal/questions-juriste.md`) |
| APDP | Aucune formalité accomplie (`docs/legal/apdp.md`) | F1 à F5 après l'avis du juriste |
| Décisions en attente | — | Durées E2 à E5, tuiles (E7), iOS en V1 ou non, téléphone de test de 2 à 3 Go, suppression des comptes de test de la base de dev |

## 8. Les 3 prochaines actions recommandées

1. **Lancer le juridique et choisir l'hébergeur maintenant** : ce sont les délais les plus longs, et ils conditionnent la politique, l'APDP et le déploiement. Envoyer les 23 questions au juriste, fixer l'identité du responsable, choisir l'hébergeur en tenant compte de la localisation des données.
2. **Brancher une CI** (GitHub Actions : lint, typecheck, tests Go avec intégration, Web, Mobile), après avoir relevé les délais des tests d'interface pour qu'elle soit stable. Compter environ une journée.
3. **Déployer un staging HTTPS** (API, worker, PostGIS, Redis, OSRM, SMTP réel, sauvegardes) avec l'étape 10B (E1, E6, page web de suppression de compte), renseigner `EXPO_PUBLIC_API_URL`, refaire un build `preview` : c'est la bêta fermée Android.
