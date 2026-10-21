# GoStation — CLAUDE.md

App mobile qui trouve **la station la plus proche ayant EN STOCK** le produit recherché (gaz domestique par taille de bouteille en kg, essence, gasoil), puis guide l'utilisateur jusqu'à elle sur une carte intégrée. Marché : Bénin. Hors V1 : les prix (D68), plusieurs stations par compte gérant et les comptes employés (V2, D67).
Détails techniques (modèle de données, endpoints, algorithme) : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Règles non négociables

1. La recherche n'affiche que des stations `approved`, **ouvertes**, avec `stock > 0` mis à jour il y a **≤ 24 h**. Au-delà de 8 h, le résultat porte le flag `stale` (badge). Chaque résultat affiche « mis à jour il y a X min ».
2. La position de l'utilisateur n'est **jamais** persistée : ni en base, ni dans les logs, ni comme clé de cache, ni dans une tâche asynq. Cela vaut pour la recherche, l'itinéraire et les signalements (contrôle des 2 km fait en mémoire). Les stats se font uniquement par cellule H3 anonyme.
3. Toute UI (mobile et web) se conçoit avec le skill **`ui-ux-pro-max`**. Composants web via le **MCP 21st.dev** ; le mobile s'en inspire.
4. Pas d'ORM ni de Drizzle : SQL écrit à la main, compilé par **sqlc** ; migrations **goose**.
5. Les secrets vivent dans `.env` uniquement : jamais commités, jamais dans un bundle mobile ou web.
6. Routage uniquement via notre OSRM auto-hébergé ; tuiles uniquement OpenFreeMap. Aucune API cartographique propriétaire.
7. **Auth** : email vérifié par code à 6 chiffres (obligatoire pour signaler, favoris, notifications) ; 2FA TOTP obligatoire pour les admins ; réponses génériques (anti-énumération) sur login, forgot et resend ; toute action sensible écrit dans `audit_logs`.
8. Les justificatifs IFU sont chiffrés (envelope AES-256-GCM) et ne sont jamais servis publiquement : seuls les admins les lisent, via un endpoint dédié et audité.
9. **Stocks** : « non vendu » (pas de ligne) ≠ « 0 en stock ». Fraîcheur = `GREATEST(updated_at, last_confirmed_at)` : stale au-delà de 8 h, exclu de la recherche au-delà de 24 h. Toute écriture de stock, statut, horaires, fermeture, produits vendus, position, informations de station ou catalogue invalide le cache de recherche. L'admin ne modifie jamais les stocks.
10. **Recherche** : couverture = Bénin (OSRM), jusqu'à 30 km au-delà de la frontière (vol d'oiseau, `routingApproximate`), sinon 422 `search.out_of_coverage`. Le cache Redis ne contient que l'ensemble des stations candidates par (cellule H3 res 8, produit) ; le classement depuis la position exacte (OSRM `/table`) n'est jamais mis en cache ni journalisé. **Aucun lat/lng dans les logs** (le journal d'accès masque les valeurs de la query string hors liste blanche, `lat=***&lng=***` ; les erreurs OSRM sont expurgées de leur URL) : un test le vérifie.
11. **Itinéraire** : l'API renvoie des étapes structurées sans texte ; le mobile les traduit en français avec `osrm-text-instructions` (langue `fr`).
12. **Notifications** (worker asynq) : l'API ne fait que mettre en file. Les emails voyagent chiffrés dans Redis ; aucune adresse, aucun token push, aucun texte de notification dans les logs (le Pusher factice ne journalise que le type). Un appareil push est lié à sa session : révocation ou logout = token supprimé.
13. **Admin** : toutes les routes `/api/v1/admin/*` exigent la session web (cookie, 2FA passée, Bearer refusé), donc le jeton CSRF sur toute écriture. Validation stricte (champ JSON ou paramètre de requête inconnu → erreur), pagination par curseur partout. Les actions admin sur un compte ou une station exigent un motif (sauf l'approbation d'un dossier) ; toute action admin qui modifie une donnée passe au journal d'audit.
14. **Stats et exports admin** : une cellule H3 n'est montrée ou exportée qu'avec au moins **5 recherches** sur l'agrégat affiché (cellule × produit ou tous produits × période), sinon elle est masquée. Les exports (worker) sont chiffrés, supprimés 24 h après leur génération, téléchargés par un lien signé valable 1 h, audités ; jamais la liste des utilisateurs, jamais d'email (auteurs des signalements pseudonymisés).
15. **Clients (mobile et web)** : le refresh des tokens est **single-flight obligatoire**. Un seul appel à `/auth/refresh` à la fois ; les requêtes en échec 401 attendent son résultat puis sont rejouées. Deux refresh concurrents avec le même token sont pris pour une réutilisation et révoquent la session.

## Règles mobile

- **Une seule app** (`bj.gostation.app`) pour les utilisateurs et les gérants, navigation selon le rôle ; Android d'abord, code compatible iOS (D49). Cible : Android d'entrée et de milieu de gamme (2 à 3 Go), data chère : 60 fps (listes, carte, animations), démarrage à froid < 2,5 s, requêtes et tuiles minimisées (D50).
- **Position** (règle 2, D51) : en mémoire seulement (store non persisté) ; jamais dans une clé de requête, MMKV, les préférences ou une URL. Résultats de recherche et itinéraires en mémoire ; seules les requêtes `['public', …]` sont persistées (`src/test/privacy.test.ts`).
- **Session** : refresh token dans expo-secure-store, access token en mémoire, refresh single-flight (`src/api/session.ts`) ; en-tête `X-Install-Id` (UUID tiré au premier lancement).
- **Textes** : français, tous dans `src/i18n/` (`fr.ts`, `errors.ts` par code stable) ; aucun texte en dur dans un composant (hors `/design`).
- **Design** : tokens générés depuis le web (`npm run gen:tokens`), classes sémantiques NativeWind ou `useTheme().colors` ; couleur brute refusée par ESLint (hors `src/theme`). Composant Reanimated avec classes : `AnimatedView` / `AnimatedPressable` de `src/lib/animated.tsx`, jamais `className` sur `Animated.View` (css-interop casserait le style animé). Cibles ≥ 48 dp, libellés pour lecteurs d'écran, police dynamique, contrastes AA. Documenté dans `Mobile/docs/design-system.md`, vitrine `/design` (dev seulement).
- **Firebase** : `google-services.json` jamais commité (`Mobile/.gitignore`) ; build EAS : variable d'environnement EAS de type fichier `GOOGLE_SERVICES_JSON` ; en local : `Mobile/google-services.json`, lu par `app.config.ts` s'il existe.
- **Build EAS** (D77) : profils `development` (dev client), `preview` (APK interne, canal `preview`), `production` (AAB, canal `production`), `versionCode` incrémenté par EAS, `runtimeVersion` par empreinte (`eas.json` et la configuration native en font partie ; `production` sans `.env`, `EXPO_NO_DOTENV=1`). `EXPO_PUBLIC_API_URL` est aussi une variable EAS (development, preview) : `eas update` ne lit ni le profil ni `.env`. Outils de test des push (D78) : `make dev-remind`, `make dev-notify`, `make dev-decide` (dev seulement).
- **Carte** : style OpenFreeMap recoloré (`npm run gen:map-styles`, sans sprite ni raster), marqueurs en couches natives regroupées (jamais une vue React par marqueur), caméra limitée au Bénin, cache ambiant 80 Mo. Crédits par `MapAttribution` (« © OpenStreetMap · OpenFreeMap », cible de 48 dp, toujours visible sur la carte), jamais le bouton ⓘ natif.
- **Dev sur téléphone** : `adb reverse tcp:8080 tcp:8080` (API) et `tcp:8081` (Metro) ; URL de l'API dans `EXPO_PUBLIC_API_URL` (D55).
- **Station fermée** : afficher clairement « Fermée · rouvre à HH:MM » (heure locale de `nextOpening`, jour en plus s'il ne s'agit pas d'aujourd'hui : « rouvre demain à 06:00 »).
- **Itinéraire indisponible** (`/routes` → 503 `routing.unavailable`) : tracer une ligne droite vers la station et proposer « Ouvrir dans une autre app » (Android : intent `geo:lat,lng?q=lat,lng(Nom)` ; iOS : Apple Plans). Les 422 (`routing.no_route`, `search.out_of_coverage`) ont leur propre message.
- **Étapes d'itinéraire** traduites en français avec `osrm-text-instructions` (règle 11).
- **Autorisation des notifications** (D70) : jamais au premier lancement (Android 13+ répond « refusée » avant toute demande : refus seulement après la demande de l'app). Gérant : écran d'explication des rappels juste après la validation de sa station (une fois par installation), puis demande du système ; utilisateur : à l'activation de sa première alerte « de retour en stock ». Refus : bandeau discret avec lien vers les réglages (Stocks, Favoris). À tester sur Android 13+ (POST_NOTIFICATIONS).
- **Push** (D71) : compte vérifié et autorisation accordée → `POST /me/devices` à **chaque lancement** et à chaque changement de token (token Expo, `installId` = le même UUID que `X-Install-Id`, langue). Logout et révocation de session suppriment le token côté serveur.
- **Canaux Android** (D72) créés au démarrage : `stock-reminders` (haute), `stock-alerts`, `reports`, `account` ; `stock-confirmations` (basse, sans son) pour la confirmation locale. Le backend choisit le `channelId` d'après le type. App ouverte (D73) : jamais de notification système, un toast et le compteur de la boîte de réception.
- **Push Android** (D75) : chaque push arrive en **message de données** (un push avec titre serait affiché par le système, sans les actions du rappel, et perdrait son lien si Android a tué le processus) ; la tâche `gostation-push-actions` (définie en premier dans `index.ts`, lancée app en arrière-plan ou tuée) le présente : texte composé d'après `type` + `data`, canal `data.channelId`, catégorie `stock_reminder` pour un rappel. `update` « Mettre à jour » ouvre Stocks ; `confirm` « Rien n'a changé » (`opensAppToForeground: false`) confirme sans ouvrir l'app : version **courante** des stocks et `POST …/stocks/confirm` avec `If-Match` (une seconde tentative sur 412), jamais l'`etag` du push ; puis notification discrète, ou invitation à ouvrir l'app en cas d'échec. Chaque réponse n'est traitée qu'une fois ; le lien d'une notification s'ouvre quand la navigation est prête. R8 garde `expo.modules.adapters.react.apploader.**` (`app.config.ts`). Tâches de fond et lancements à froid : à tester sur un build release (le dev client les détourne) et en fermant l'app depuis les récents (un `am force-stop` bloque FCM).
- **Boîte de réception** : le texte se compose d'après `type` + `data` (clés i18n), jamais d'après un texte serveur. Une notification `station_reported` n'identifie jamais les auteurs. `station_decision` (D74) ne porte jamais le motif.
- **Signalement** « stock épuisé » ou « station fermée » : envoyer la position courante dans le corps (`position`), uniquement pour ce contrôle.
- **Espace gérant** (D58, D63) : espace choisi d'après `GET /me` (rôle et statut de la station mémorisés dans MMKV, sans donnée personnelle, pour le démarrage hors connexion). `pending`, `rejected`, `suspended` : écran de statut seulement (`rejected` : correction et nouveau justificatif). `approved` : onglets Stocks (accueil), Ma station, Signalements, Notifications, Compte ; la recherche reste ouverte. Checklist `setup` tant que la station n'apparaît pas dans la recherche.
- **Saisie des stocks** (D59, D60) : compteur +/− (appui long qui accélère, nombre modifiable au toucher) pour les bouteilles, pavé numérique en litres pour les carburants, « Rupture » par produit, récapitulatif avant l'envoi, « Rien n'a changé » sans modification. `PUT` groupé avec `If-Match` ; 412 : montrer ce qui a changé et recharger sans perdre la saisie. Brouillon conservé hors connexion (MMKV), envoi bloqué avec un message puis proposé au retour du réseau, **jamais envoyé automatiquement**.
- **Liens profonds** (D61) : `/manager/stocks`, `/manager/reports`, `/manager/status`, `/manager/station`, `/station/{id}`, stables pour les notifications. Rappel → Stocks ; retour en stock → fiche de la station ; signalements → Signalements ; décision → statut (refus, suspension) ou Ma station (`src/features/notifications/routing.ts`).
- **Inscription gérant** (D62) : étapes avec progression (compte, station, justificatif) ; IFU de 13 chiffres validé pendant la saisie ; photos réduites sur le téléphone avant l'envoi (bien sous 5 Mo) ; brouillon des champs texte chiffré, jamais le mot de passe ni le justificatif.
- **Position de la station** (D64) : épingle fixe au centre d'une carte plein écran, avertissement « Placez l'épingle sur la station, pas sur vous » ; position et précision de l'appareil envoyées avec la requête, jamais stockées. Déplacement de plus de 200 m : demande en attente, l'ancienne position reste active.

## Règles web (admin)

- **Session** : cookies posés par l'API, jeton CSRF dans `X-CSRF-Token` sur toute écriture (cookie `gs_csrf` s'il est lisible, sinon la copie en mémoire reçue au login ou au refresh, sinon `GET /auth/csrf` après un rechargement ; jamais dans le stockage du navigateur, cf. D43). Refresh single-flight **aussi entre onglets** (Web Locks + horodatage partagé), voir `src/api/session.ts`. Session expirée → `/login?redirect=<page>&reason=expired`, la page demandée est rouverte après connexion (redirection interne uniquement).
- **Textes** : français seulement, tous dans `src/i18n/` (`fr.ts` pour la coquille et la connexion, `admin.ts` pour les écrans, chargé avec eux ; `errors.ts` par code stable). Aucun texte en dur dans un composant.
- **Écrans** (D47) : filtres et élément ouvert dans l'URL, pagination par curseur, `DataTable` / `DetailPanel` / `ReasonDialog` de `src/components/`, écritures sur une station avec `If-Match` et gestion du 412 sans perte de saisie, optimiste seulement pour l'ordre du catalogue, confirmation avant toute action destructive.
- **Design** : tokens de `src/styles/globals.css` uniquement (palette Tailwind par défaut désactivée, couleur brute refusée par ESLint), documentés dans `Web/docs/design-system.md` et présentés sur `/design` (dev seulement). Contrastes AA vérifiés par `src/styles/tokens.test.ts`. Thème : système par défaut, bascule mémorisée (D42).
- **Graphiques** : shadcn Chart (Recharts), palette catégorielle en ordre fixe, statuts réservés, résumé + tableau pour lecteurs d'écran (D41).
- **CSP** : générée à la build (`build/csp.ts` → `dist/csp.txt`, servie par Caddy et `vite preview`) ; un nouveau script en ligne, une nouvelle origine ou un nouveau worker passe par ce fichier. Les E2E échouent sur toute violation.
- **Performance** : JS initial < 200 Ko gzip (`npm run check:bundle`), Lighthouse desktop ≥ 95 et mobile ≥ 85 visé (connexion et tableau de bord, médiane de 3 passes), animations en transform et opacité, `prefers-reduced-motion` respecté, gros modules (MapLibre, Recharts, pdf.js, dnd-kit, calendrier, ⌘K, QR code) chargés à la demande, formateurs `Intl` créés au premier usage. Le premier rendu ne doit jamais suspendre (route résolue avant, `build/route-preload.ts`).
- **Accessibilité** : WCAG 2.2 AA vérifié par axe-core sur chaque écran et dialogue, clair et sombre (`e2e/a11y.spec.ts`) ; tout glisser-déposer a son équivalent clavier.
- **Types d'API** : générés depuis `Backend/api/openapi.yaml` (`npm run gen:api`) après toute modification de la spec ; les schémas zod des réponses sont vérifiés contre ces types (`satisfies`).
- **Captures** : `npm run screenshots` régénère `Web/docs/screenshots/` (chaque écran en clair et en sombre à 1440 px, les principaux aussi à 1024 px). Les écrans 2FA y utilisent des réponses simulées (jamais de vrai secret dans le dépôt).
- **E2E** (D46) : pile isolée `scripts/e2e-stack.sh` (base `gostation_e2e`, Redis 15, API 8095), lancée et supprimée par Playwright ; jamais de compte de test dans la base de dev. `E2E_KEEP=1` garde la pile entre deux lancements.

## Rôles

| Rôle | Client | Périmètre |
|---|---|---|
| `user` | Mobile | Recherche, fiche station et itinéraire **sans compte** (rate limit par IP). Un compte (prénom, nom, email, mot de passe) est requis pour signaler, gérer ses favoris et recevoir des notifications. |
| `manager` (gérant) | Mobile | Un compte gérant = une station en V1 (D67). Un même IFU peut couvrir plusieurs stations : pas d'unicité, l'admin voit « IFU déjà utilisé par N stations » (D66). Inscription avec infos station : nom, IFU (13 chiffres), RCCM, marque, adresse, téléphone (vérifié manuellement par l'admin, pas d'OTP SMS en V1), justificatif. Statut station `pending → approved / rejected / suspended`, décidé par l'admin (email à chaque décision). Le dossier n'apparaît chez l'admin qu'une fois l'email vérifié. Gérant `pending` ou `suspended` : il se connecte et voit son statut via `GET /me`, rien d'autre. Gérant `rejected` : il peut corriger ses informations et renvoyer un justificatif (retour en `pending`). Un changement d'IFU ou de RCCM renvoie la station en `pending`. Position : premier épinglage libre (signalé à l'admin si à plus de 500 m de l'appareil) ; ensuite, déplacement libre sous 200 m, au-delà validé par l'admin ; jamais hors du Bénin (marge de 2 km). Horaires : 2 plages par jour au plus, 24 h/24, fermetures exceptionnelles. Une fois approuvé : épingle la position **de la station** (avertissement explicite dans l'UI : « placez l'épingle sur la station, pas sur votre position »), saisit les horaires d'ouverture et les stocks (gaz : nombre de bouteilles par taille ; essence/gasoil : litres). Rappel push toutes les 4 h pendant les horaires d'ouverture (4 par jour au plus, sourdine jusqu'à la fermeture, arrêt et alerte admin après 3 rappels ignorés). Voit les signalements de sa station, sans leurs auteurs. |
| `admin` | Web | Compte créé uniquement par la CLI `cmd/admin`, 2FA TOTP obligatoire, session web (cookie + CSRF). Tableau de bord (période 24 h / 7 j / 30 j / plage, évolution sur la période précédente), validation et correction des stations (motif, ETag, email au gérant ; jamais les stocks), carte des stations, filtres (stale, exclues, gérant inactif, sans horaires, signalée), zones de pénurie (≥ 50 % de recherches sans station ouverte à 5 km, k ≥ 5), stats des recherches, comptes (désactiver, réactiver, rétablir le droit de signaler, renvoyer le code ; motif et audit), catalogue produits (création ; libellé, ordre, activation ; aucune suppression), signalements (traité, classé abusif, retrait du droit de signaler), alertes (gérant inactif, seuil de signalements), journal d'audit, exports CSV/JSON, demandes RGPD/APDP (étape 9). |

## Monorepo

```
GoStation/
├── Backend/            API Go (cmd/api, internal/…, db/migrations, db/queries, sqlc.yaml)
├── Mobile/             Expo React Native — app unique user + manager : src/{app,features,components,api,i18n,lib,map,stores,theme}, scripts/, docs/ (design-system.md, screenshots/), .maestro/
├── Web/                Admin React (Vite) : src/{routes,features,components,api,i18n,lib,styles}, e2e/, docs/ (design-system.md, screenshots/)
├── docs/               ARCHITECTURE.md, legal/ (inventaire, politique, CGU, registre, APDP, Play, questions au juriste : source unique des textes)
├── scripts/            osrm-prepare.sh, check-infra.sh, env.sh, with-env.sh, explain-search.sh, explain-stats.sh, bench.sh (+ bench/search.js k6), e2e-stack.sh, _lib.sh
├── docker-compose.yml  PostGIS, Redis, OSRM, Mailpit + asynqmon (profil « dev »), API + worker (profil « api »)
├── Makefile            make help
└── .env.example        source de vérité des variables (infra + backend)
```

## Stack (dernières versions stables, vérifiées le 2026-10-10)

- **Backend** : Go 1.27, chi v5, pgx v5 (pgxpool), sqlc, goose v3, go-redis v9, golang-jwt v5 (access 15 min signé en **EdDSA/Ed25519** avec `kid`), refresh tokens opaques rotatifs dans Redis, argon2id aux paramètres OWASP (`golang.org/x/crypto/argon2`), TOTP RFC 6238, SMTP via `net/smtp` (Mailpit en dev), asynq v0.26 (worker : emails, push Expo, rappels, stats, purges ; asynqmon 0.7 en dev), uber/h3-go v4, `log/slog`.
- **Données** : PostgreSQL 18 + PostGIS 3.6 (`geography(Point,4326)`, index GiST, `uuidv7()` natif), Redis 8.10 (cache, refresh tokens, files asynq ; `maxmemory-policy noeviction`).
- **Carte** : MapLibre (mobile : `@maplibre/maplibre-react-native` v11 ; web : `maplibre-gl` v6), tuiles OpenFreeMap, OSRM v26.10 (extrait Bénin Geofabrik, profil car, algorithme MLD).
- **Mobile** : Expo SDK 57 en **dev build** (MapLibre est natif, donc pas d'Expo Go), Hermes + New Architecture, TypeScript strict, React Compiler, Expo Router (routes typées), NativeWind 4 (Tailwind 3), Reanimated 4, Gesture Handler, @gorhom/bottom-sheet 5, FlashList 2, expo-image, expo-haptics, lucide-react-native, TanStack Query 5 (persisté dans MMKV v4), Zustand 5, react-hook-form + zod/mini, openapi-fetch, expo-secure-store, expo-location, expo-keep-awake, expo-speech, osrm-text-instructions, NetInfo, expo-notifications (9B). Tests : jest-expo + React Native Testing Library 14, Maestro, Flashlight. `ios/` et `android/` sont générés par CNG (`expo prebuild`) et ne sont pas commités.
- **Web** : Vite 8, React 19 (React Compiler), TypeScript strict, Tailwind CSS 4, shadcn/ui (Radix) + composants 21st.dev, TanStack Router (routes fichiers) + Query + Table, react-hook-form + zod/mini, openapi-typescript + openapi-fetch, Recharts via shadcn Chart, maplibre-gl, motion, lucide-react, polices Geist auto-hébergées. Tests : Vitest + Testing Library, Playwright.
- **Outillage Go** (installé par `make tools`, versions figées dans le Makefile) : goose v3.28, sqlc v1.31, golangci-lint v2.14. Tests d'intégration avec testcontainers-go. Go 1.27 installé via snap (`/snap/bin/go`).
- Les versions exactes sont figées par `go.mod` et les lockfiles. On reprend les versions fournies par les templates Expo et Vite à l'init.

## Commandes

```bash
# Infra (Docker)
make env            # .env depuis .env.example + secrets aléatoires (n'écrase jamais)
make osrm-prepare   # télécharge l'extrait Bénin + extract/partition/customize (FORCE=1 pour retraiter)
make up             # démarre PostGIS, Redis, OSRM et Mailpit (emails de dev : http://127.0.0.1:8025)
make env-sync       # ajoute à .env les variables apparues dans .env.example (secrets générés)
make check          # vérifie healthchecks, PostGIS_Version(), Redis, OSRM /route et /table sur Cotonou
make ps | logs s=osrm | db-shell | redis-cli | down

# Backend (Go)
make tools          # installe goose, sqlc et golangci-lint (versions figées)
make run            # lance l'API sur l'hôte avec les variables de .env
make worker-run     # lance le worker asynq sur l'hôte (emails, push, rappels… : à lancer à côté de make run)
make build          # compile Backend/bin/api et Backend/bin/worker
make test           # tests unitaires + intégration (testcontainers, Docker requis), avec -race
make lint           # golangci-lint (formatage gci + gofumpt vérifié)
make sqlc           # régénère internal/store/dbgen depuis db/queries
make migrate-up | migrate-down | migrate-status | migrate-new name=add_x
make api-up         # API + worker dans Docker (profil compose « api »), healthchecks sur /readyz
make worker-up      # worker seul dans Docker (une seule instance : le scheduler est intégré)
make admin-create email=… first=… last=…   # crée un admin (mot de passe saisi au clavier, jamais en argument)
make admin-reset-2fa email=…               # réinitialise la 2FA d'un admin

# Recherche et stats admin
make purge-dry-run  # simule les purges de conservation : lignes que chaque règle traiterait maintenant, sans rien modifier
make legal-html     # HTML statique des textes légaux (docs/legal/*.md → var/legal/)
make seed-dev       # remplace les stations fictives (5 000 au Bénin, is_demo) et 30 jours de stats de recherche (dev uniquement ; RESET=1 pour supprimer)
make explain-search # EXPLAIN ANALYZE des requêtes de recherche, vérifie l'index GiST
make bench          # k6 (Docker) sur /search, 5 zones : p50/p95/p99 hors cache / avec cache / OSRM, taux de cache
make explain-stats  # EXPLAIN ANALYZE des stats admin (agrégats journaliers et tous lieux, index de search_stats)
make bench-stats    # p50/p95/p99 du tableau de bord, des stats et des cartes sur seed-dev (échoue si un p95 > 300 ms)
scripts/with-env.sh <cmd>   # comme « . .env » mais sans écraser les variables déjà définies (surcharges ponctuelles)

# Admin web (dans Web/ ; l'API doit tourner : make up && make api-up, ou make run)
npm install         # dépendances (versions figées par package-lock.json)
npm run dev         # Vite sur 5173, proxy /api vers 127.0.0.1:8080 (VITE_API_PROXY_TARGET)
npm run gen:api     # régénère src/api/schema.d.ts depuis Backend/api/openapi.yaml
npm run lint        # ESLint + Prettier ;  npm run typecheck : tsc -b
npm test            # Vitest (unitaires et composants)
npm run build && npm run check:bundle   # build de production + budget du JS initial (< 200 Ko gzip)
npm run e2e         # Playwright sur le build (vite preview, 4173) et une pile isolée (make up suffit : base gostation_e2e, API 8095)
npm run screenshots # captures de Web/docs/screenshots (chaque écran, clair/sombre, 1440 et 1024 px)
```

# App mobile (dans Mobile/ ; téléphone en débogage USB, l'API doit tourner)
npm install         # dépendances (versions figées par package-lock.json)
npm run android     # compile et installe le dev build (expo run:android), puis Metro
npm start           # Metro seul (dev build déjà installé)
adb reverse tcp:8080 tcp:8080 && adb reverse tcp:8081 tcp:8081   # API et Metro vus du téléphone
npm run gen:api | gen:tokens | gen:map-styles | gen:icons | gen:legal   # types d'API, tokens, styles de carte, icônes, textes légaux
npm run lint        # ESLint + Prettier ;  npm run typecheck : tsc --noEmit
npm test            # Jest (logique et composants)
npm run e2e         # Maestro (.maestro/) contre la pile isolée (base gostation_e2e, API 8095) ; build release installé
npm run screenshots # captures de docs/screenshots/ (chaque écran, clair et sombre)
npm run perf        # Flashlight (FPS, CPU, RAM) : recherche + défilement, navigation → var/perf/
npm run states      # états mis en scène sur la pile isolée (aucune station, fermée/signalée, hors connexion, localisation refusée, alerte de retour en stock, compte, guidage simulé, OSRM coupé) + captures
npm run a11y        # audit d'accessibilité par écran (noms accessibles, cibles ≥ 48 dp) + captures en police ×1,5 → var/a11y/

Ports hôte (liés à 127.0.0.1, surchargeables dans `.env`) : PostGIS **5440**, Redis **6390**, OSRM **5000**, API **8080**, Mailpit **1025** (SMTP) / **8025** (web), asynqmon **8090**, Vite **5173** (preview **4173**), API E2E **8095** (worker **8096**). Le worker expose ses sondes sur **8081** (`WORKER_HEALTH_ADDR`, non publié par Docker). Les ports 5432 et 6379 sont déjà pris sur la machine de dev.

## Algorithme de recherche (détail : ARCHITECTURE §4)

1. **Cache** Redis devant la base : ensemble des candidats par cellule H3 res 8 + produit (+ générations), TTL 60 s, rayon élargi du rayon de la cellule. Toute écriture de stock, statut, horaires, fermeture, produits vendus ou position invalide le cache.
2. **Rayons progressifs** avec `ST_DWithin` : 500 m, 1, 2, 5, 10, 25, 50 km, sur les stations `approved`, **ouvertes**, avec `stock > 0` frais (≤ 24 h). On s'arrête au premier rayon qui donne `SEARCH_MIN_RESULTS` candidats.
3. **Repli** s'il n'y a aucune station ouverte à 50 km : ouvertes au-delà (KNN illimité) et fermées, triées par heure à laquelle on peut être servi = `max(maintenant + trajet, prochaine ouverture)`, puis par trajet. Il y a donc toujours un résultat dès qu'une station du pays a un stock frais et des horaires.
4. Stations sans horaires, non vendues, à 0, expirées (> 24 h), non approuvées ou exclues par 5 signalements (le produit, ou toute la station) : exclues. À 3 signalements : badge `reported`.
5. **Classement par requête** depuis la position exacte : OSRM `/table` (1 source → 10 meilleurs candidats), jamais mis en cache. Hors du Bénin (≤ 30 km) ou OSRM en panne / hors délai : vol d'oiseau, durées estimées, `routingApproximate: true`.
6. Chaque résultat porte `stockUpdatedAt`, `updatedAgoS` (« mis à jour il y a ») et `stale` (8 h à 24 h), `isOpen`, `nextOpening`, `servedAt`.
7. **Stats anonymes** : cellule H3 res 7, produit, heure, recherches, recherches sans station ouverte à 5 km ou moins. Compteurs Redis vidés dans `search_stats`.

## Conventions

### Langue
- Identifiants en anglais : code, tables, colonnes, routes API, clés JSON, codes d'erreur, messages de commit.
- Documentation et commentaires en français. Textes UI en français via clés i18n (`fr` par défaut, prêt pour `en`).
- Messages d'exécution en anglais : erreurs Go, logs, `title` et `detail` des problem+json. Le client traduit d'après le `code`.

### Commits et branches
- [Conventional Commits](https://www.conventionalcommits.org) : `type(scope): description` à l'impératif, ≤ 72 caractères.
  Types : `feat fix perf refactor test docs build ci chore revert`. Scopes : `backend mobile web infra db docs deps`. Rupture : `feat(backend)!:` + pied `BREAKING CHANGE:`.
- Un changement logique par commit ; une migration goose dans son propre commit `feat(db): …`.
- Branches : `main` protégée ; `feat/<scope>-<slug>`, `fix/<scope>-<slug>`. PR en squash merge, CI verte obligatoire.

### Nommage
- **Go** : packages courts, minuscules, au singulier (`station`, `search`, `auth`) ; fichiers `snake_case.go` ; `NewXxx` pour les constructeurs ; erreurs sentinelles `ErrXxx` ; `ctx context.Context` en premier paramètre ; interfaces déclarées côté consommateur.
- **Arborescence Backend** (module `gostation/backend`) :
  - `cmd/api` : point d'entrée. `run()` assemble les dépendances ; la sous-commande `api healthcheck` sert au healthcheck Docker.
  - `cmd/worker` : worker asynq (tâches + scheduler, **une seule instance**), sondes `/healthz` et `/readyz` ; `worker healthcheck` pour Docker.
  - `internal/config` : config depuis l'environnement, validée, échec explicite.
  - `internal/apperr` : erreurs typées et codes stables.
  - `internal/http/{router,middleware,handler,respond,httpctx}` : routeur chi, middlewares, handlers qui renvoient `error`, rendu JSON et problem+json, valeurs de contexte (request ID, IP client).
  - `internal/store` : transactions (`InTx`) et traduction des erreurs pgx ; `internal/store/dbgen` contient le code **généré** par sqlc, à ne jamais éditer.
  - `internal/platform/{postgres,redis,osrm,h3,logging}` : clients d'infrastructure ; `internal/ratelimit` : fenêtre glissante Redis.
  - `internal/app` : assemblage (`NewServices`, `NewHandler`, `NewWorker`), partagé par `cmd/api`, `cmd/worker`, `cmd/admin` et les tests d'intégration.
  - `internal/jobs` (types de tâches, files, charges utiles, client de mise en file, backoff) et `internal/worker` (handlers asynq et scheduler). Les domaines ne dépendent pas d'asynq : ils déclarent de petites interfaces (`EnqueueEmail`, `EnqueuePush`…) que `jobs.Client` implémente.
  - Domaines : `internal/auth` (comptes, sessions, codes, TOTP, gestion des comptes par l'admin), `internal/station` (espace gérant, horaires et `IsOpen`, stocks, validation, correction, carte et filtres admin), `internal/document` (justificatifs), `internal/mail` (Mailer SMTP + templates), `internal/audit`, `internal/searchcache` (générations du cache de recherche), `internal/search` (recherche, fiche publique, itinéraire), `internal/searchstats` (compteurs anonymes et vidage), `internal/push` (Pusher Expo et factice), `internal/notification` (appareils, boîte de réception, préférences, livraison des push), `internal/reminder` (rappels de stock, sourdine), `internal/report` (signalements, seuils, modération, alertes admin), `internal/favorite` (favoris, alertes « de retour en stock »), `internal/retention` (purges de conservation), `internal/analytics` (tableau de bord, stats, pénuries, relevé de fraîcheur), `internal/catalog` (catalogue produits admin), `internal/export` (exports admin : génération, chiffrement, lien signé, purge). `internal/pagination` : taille de page et curseurs communs.
  - `internal/platform/{crypto,storage,healthprobe}` : chiffrement (enveloppe, HKDF), stockage d'objets (local, S3 plus tard), sonde `/readyz` des healthchecks Docker.
  - `cmd/admin` : CLI des comptes admin (`create`, `reset-2fa`).
  - `cmd/seed` : stations fictives et 30 jours de stats de recherche de développement (`make seed-dev`, refuse hors `APP_ENV=development`) ; `cmd/benchstats` : latence des stats admin sur ce jeu (`make bench-stats`) ; `cmd/e2efixtures` : données des scénarios E2E (base `*_e2e` uniquement).
  - `api/openapi.yaml` : contrat OpenAPI 3.1, **mis à jour dans le même commit que toute route** (un test compare la spec aux routes servies). Les types des clients mobile et web en sont générés.
  - `db/migrations/` (goose, `YYYYMMDDHHMMSS_desc.sql` en **UTC**, créées par `make migrate-new`, toujours avec un Down, une migration de données à part) et `db/queries/` (sqlc). Les migrations sont embarquées (`db.Migrations`) pour les tests. Après modification d'une requête : `make sqlc`.
  - Piège SQL : un `CHECK` évalué à NULL passe. Toute condition sur une colonne nullable doit donc tester `IS NOT NULL` explicitement.
- **Injection de dépendances explicite** : constructeurs `NewXxx(deps…)`, aucune variable globale mutable, pas d'`init()` qui configure quoi que ce soit, `context.Context` partout.
- **sqlc** : le type `geography` n'est jamais exposé. Les requêtes prennent `lat`/`lng` en `float8` (`ST_MakePoint(lng, lat)`) et lisent les colonnes générées `stations.lat`/`lng` (une expression `ST_Y(...)` serait typée non nullable par sqlc). Colonnes explicites (pas de `SELECT *`).
- **Dates** : `timestamptz` en base, lues en UTC par pgx (codec forcé dans `platform/postgres`), renvoyées en RFC 3339 UTC.
- **SQL** : `snake_case` ; tables au pluriel ; PK `id uuid DEFAULT uuidv7()` (sauf référentiels en `smallint identity`) ; FK `<entite>_id` ; horodatages `timestamptz` suffixés `_at`, en UTC ; enums PostgreSQL ; contraintes nommées `pk_ fk_ uq_ ck_ idx_<table>_<cols>`. Requêtes sqlc : `GetStationByID`, `ListStationsWithinRadius`, `UpsertStationStock`.
- **API** : REST JSON sous `/api/v1` ; ressources au pluriel en kebab-case (`/opening-hours`) ; clés JSON en camelCase ; dates RFC 3339 UTC ; coordonnées `{ "lat", "lng" }`. Attention : PostGIS et OSRM attendent l'ordre **lng, lat**. Pagination par curseur `?limit=&cursor=` → `{ items, nextCursor }`.
- **Verrouillage optimiste** : les ressources modifiables concurremment (station et tout ce qui en dépend) renvoient un `ETag` (`"v{version}"`). Toute écriture exige `If-Match` : 428 `request.precondition_required` s'il manque, 412 `resource.version_conflict` s'il est périmé (le client recharge puis rejoue).
- **TypeScript** : fichiers kebab-case (`station-card.tsx`), composants PascalCase, hooks `useXxx`, stores Zustand `useXxxStore`, schémas zod `xxxSchema` + `type Xxx = z.infer<…>`, fabriques de query keys par domaine (`stationKeys.detail(id)`).

### Gestion des erreurs
- **Go** : toute erreur est traitée ou remontée avec contexte : `fmt.Errorf("station.UpdateStock: %w", err)` ; utiliser `errors.Is` / `errors.As`.
- Les erreurs métier sont typées dans `internal/apperr` (`Code`, `Status`, `Message`, `Fields`). Le store convertit `pgx.ErrNoRows` → `NotFound` et `23505` → `Conflict`.
- Un seul point de rendu HTTP : les handlers renvoient une `error`, le middleware répond en **RFC 9457** `application/problem+json` `{ type, title, status, detail, code, requestId, errors?[{ field, message }] }`. Le `code` est stable (`station.not_approved`), le client le traduit en message français.
- Une 5xx renvoie un message générique au client et un log complet via slog (`request_id`, `user_id`, `route`). Jamais de mot de passe, de token, de coordonnées ni de document dans les logs. Middleware `recover` pour les panics.
- Les appels externes (OSRM, Expo Push, SMTP) passent par `context` avec timeout et basculent en mode dégradé plutôt qu'en échec : repli vol d'oiseau pour OSRM, retry avec backoff (tâches asynq) pour Expo et SMTP.
- JSON entrant : `DisallowUnknownFields`, taille de corps bornée, validation au handler.
- **Clients** : réponses API validées par zod ; erreurs typées `ApiError` (issues de problem+json) ; retry TanStack Query seulement sur erreur réseau ou 5xx ; error boundary par écran ; jamais de message technique brut affiché.

### Tests
- **Go** : `go test -race ./...`. Tests unitaires en table pour la logique métier (classement de la recherche, horaires d'ouverture, rappels, clés H3, rotation des tokens).
- Tests d'intégration sous build tag `integration`, contre un vrai PostGIS et un vrai Redis via testcontainers-go, avec les **mêmes images que le compose** (`POSTGIS_IMAGE`, `REDIS_IMAGE`). Pas de mock SQL. Handlers testés avec `httptest`, clients OSRM et Expo avec un serveur `httptest`. Le worker asynq tourne dans le processus de test (sans scheduler : les tâches périodiques sont appelées directement, avec une horloge réglable). `make test` lance unitaires + intégration.
- Objectif ≥ 80 % de couverture sur `internal/search` et `internal/auth`.
- **Mobile** : jest-expo + React Native Testing Library ; E2E Maestro (recherche → itinéraire, mise à jour de stock par le gérant).
- **Web** : Vitest + Testing Library ; E2E Playwright (décisions sur les stations, déplacement, correction en conflit 412, signalements, comptes, catalogue, exports, CSRF après rechargement, accessibilité axe-core).
- Tout correctif de bug s'accompagne d'un test de régression. Lint : golangci-lint, ESLint + Prettier, `tsc --noEmit`.
- **Base de dev** : aucune donnée de test (comptes, stations, signalements, emails Mailpit, fichiers, sessions) ne doit y rester à la fin d'une étape. Les essais sur téléphone utilisent des comptes synthétiques, supprimés avec leurs données liées avant la clôture.

### Variables d'environnement
- `.env.example` (racine) est la source de vérité pour l'infra et le backend. Toute nouvelle variable y est ajoutée avec un commentaire et une valeur sûre par défaut.
- `Mobile/.env` : `EXPO_PUBLIC_*` uniquement. `Web/.env` : `VITE_*` uniquement. Rien de secret dans les deux.
- Le backend charge sa config une seule fois au démarrage (`internal/platform/config` : struct typée, validée, échec immédiat avec message explicite). Pas de `os.Getenv` dispersés.
- Format des valeurs : durées au format Go (`15m`, `720h`), clés en hexadécimal. En prod, secrets fournis par l'hébergeur ou un gestionnaire de secrets, jamais dans l'image.

## Design (obligatoire)
- Skill `ui-ux-pro-max` pour toute UI ; MCP 21st.dev pour les composants web (inspiration côté mobile).
- Thème : nuances d'orange, palette complète 50 → 950, modes clair et sombre. Tokens définis une seule fois puis exposés en couleurs sémantiques (`primary`, `surface`, `muted`…).
- UI premium et intuitive, animations fluides (Reanimated sur le thread UI, transitions partagées).
- Performance : **60 fps minimum**, listes virtualisées (FlashList), clustering des marqueurs, mémoïsation (React Compiler si supporté, sinon `memo` / `useMemo` / `useCallback`), Hermes + New Architecture, `expo-image`.

## Données personnelles (Code du numérique béninois, APDP)
- **Minimisation** : on ne collecte que les champs listés ci-dessus.
- **Position** : utilisée en mémoire le temps de la requête, puis oubliée. Le cache est indexé par cellule H3 res 8 (≈ 0,74 km²), jamais par coordonnées. Les stats sont agrégées par cellule H3 res 7 et par heure (plus des agrégats par jour et tous lieux confondus), affichées et exportées seulement au-delà de k ≥ 5 recherches sur l'agrégat affiché.
- **Consentement** : écran explicatif avant la permission système. L'app reste utilisable sans localisation (choix d'un point sur la carte).
- **Inventaire** : `docs/legal/inventaire-donnees.md`, établi à partir du code. Toute nouvelle donnée personnelle (colonne, clé Redis, champ de log, fichier, stockage local, service tiers) y est ajoutée dans le même commit, avec sa finalité, sa base légale, sa durée et sa règle de purge ; la politique de confidentialité suit si l'information des personnes change.
- **Droits des personnes** (D80 à D83) : Compte › Mes données (copie JSON de 24 h, demandes, suppression) ; admin « Demandes de données ». Rien n'est traité pour une demande reçue par email avant le code de confirmation envoyé à l'adresse du compte. L'admin ne voit jamais le contenu d'une copie.
- **Suppression de compte** (`DELETE /me`, ou demande confirmée) : anonymisation immédiate (D83), sessions et appareils révoqués ; station du gérant suspendue, justificatif conservé selon sa durée.
- **Justificatifs IFU** chiffrés (AES-256-GCM, chiffrement par enveloppe) ; chaque consultation par un admin est auditée.
- **Durées de conservation** : ARCHITECTURE §8 ; valeurs par défaut à valider par un juriste (`docs/legal/questions-juriste.md`, D69), réglables par variables d'environnement (`RETENTION_*`, `PRIVACY_*`, jamais en dur). Une tâche asynq par règle (`retention:<règle>`), par lots, idempotente, qui ne journalise que des compteurs ; toute nouvelle règle a son `Count` (simulation, `make purge-dry-run`) et son test à horloge injectée.
- **Textes légaux** : source unique `docs/legal/*.md` (marqués « PROJET » tant qu'ils ne sont pas validés) ; après modification, `npm run gen:legal` (Mobile) et `make legal-html`. Une nouvelle version de la politique change son en-tête `version` et `PRIVACY_POLICY_VERSION` : l'app exige la réacceptation (D87).
- Formalités APDP avant la prod : `docs/legal/apdp.md`. Fiche Play « Sécurité des données » : `docs/legal/play-securite-donnees.md`, à revoir à chaque changement de collecte.
