# GoStation — CLAUDE.md

App mobile qui trouve **la station la plus proche ayant EN STOCK** le produit recherché (gaz domestique par taille de bouteille en kg, essence, gasoil), puis guide l'utilisateur jusqu'à elle sur une carte intégrée. Marché : Bénin.
Détails techniques (modèle de données, endpoints, algorithme) : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Règles non négociables

1. La recherche n'affiche que des stations `approved`, **ouvertes**, avec `stock > 0` mis à jour il y a **≤ 24 h**. Au-delà de 8 h, le résultat porte le flag `stale` (badge). Chaque résultat affiche « mis à jour il y a X min ».
2. La position de l'utilisateur n'est **jamais** persistée : ni en base, ni dans les logs, ni comme clé de cache. Les stats se font uniquement par cellule H3 anonyme.
3. Toute UI (mobile et web) se conçoit avec le skill **`ui-ux-pro-max`**. Composants web via le **MCP 21st.dev** ; le mobile s'en inspire.
4. Pas d'ORM ni de Drizzle : SQL écrit à la main, compilé par **sqlc** ; migrations **goose**.
5. Les secrets vivent dans `.env` uniquement : jamais commités, jamais dans un bundle mobile ou web.
6. Routage uniquement via notre OSRM auto-hébergé ; tuiles uniquement OpenFreeMap. Aucune API cartographique propriétaire.

## Rôles

| Rôle | Client | Périmètre |
|---|---|---|
| `user` | Mobile | Recherche, fiche station et itinéraire **sans compte** (rate limit par IP). Un compte (prénom, nom, email, mot de passe) est requis pour signaler, gérer ses favoris et recevoir des notifications. |
| `manager` (gérant) | Mobile | Inscription avec infos station : nom, IFU (13 chiffres), RCCM, marque, adresse, téléphone, justificatif. Statut station `pending → approved / rejected / suspended`, décidé par l'admin. Une fois approuvé : épingle la position **de la station** (avertissement explicite dans l'UI : « placez l'épingle sur la station, pas sur votre position »), saisit les horaires d'ouverture et les stocks (gaz : nombre de bouteilles par taille ; essence/gasoil : litres). Rappel push toutes les 4 h pendant les horaires d'ouverture. |
| `admin` | Web | Validation des gérants, catalogue produits (tailles de gaz configurables), carte des stations, zones de pénurie, données périmées, signalements, stats, journal d'audit, demandes RGPD/APDP. |

## Monorepo

```
GoStation/
├── Backend/            API Go (cmd/api, internal/…, db/migrations, db/queries, sqlc.yaml)
├── Mobile/             Expo React Native — app unique user + manager
├── Web/                Admin React (Vite)
├── docs/               ARCHITECTURE.md
├── scripts/            osrm-prepare.sh, check-infra.sh, _lib.sh
├── docker-compose.yml  PostGIS, Redis, OSRM (+ osrm-tools, profil « tools »)
├── Makefile            make help
└── .env.example        source de vérité des variables (infra + backend)
```

## Stack (dernières versions stables, vérifiées le 2026-10-10)

- **Backend** : Go 1.27, chi v5, pgx v5 (pgxpool), sqlc, goose v3, go-redis v9, golang-jwt v5 (access 15 min, HS256), refresh tokens opaques rotatifs dans Redis, argon2id (`golang.org/x/crypto/argon2`), asynq (jobs et rappels), uber/h3-go v4, `log/slog`.
- **Données** : PostgreSQL 18 + PostGIS 3.6 (`geography(Point,4326)`, index GiST, `uuidv7()` natif), Redis 8.10 (cache, refresh tokens, files asynq ; `maxmemory-policy noeviction`).
- **Carte** : MapLibre (mobile : `@maplibre/maplibre-react-native` v11 ; web : `maplibre-gl` v6), tuiles OpenFreeMap, OSRM v26.10 (extrait Bénin Geofabrik, profil car, algorithme MLD).
- **Mobile** : Expo SDK 57 en **dev build** (MapLibre est natif, donc pas d'Expo Go), Hermes + New Architecture, TypeScript strict, Expo Router, Reanimated 4, FlashList 2, TanStack Query 5, Zustand 5, react-hook-form + zod 4, expo-secure-store, expo-location, expo-notifications. `ios/` et `android/` sont générés par CNG (`expo prebuild`) et ne sont pas commités.
- **Web** : Vite 8, React 19, TypeScript, Tailwind CSS 4, shadcn/ui + composants 21st.dev, TanStack Query + TanStack Router, maplibre-gl.
- **Outillage Go** (installé par `make tools`, versions figées dans le Makefile) : goose v3.28, sqlc v1.31, golangci-lint v2.14. Tests d'intégration avec testcontainers-go. Go 1.27 installé via snap (`/snap/bin/go`).
- Les versions exactes sont figées par `go.mod` et les lockfiles. On reprend les versions fournies par les templates Expo et Vite à l'init.

## Commandes

```bash
# Infra (Docker)
make env            # .env depuis .env.example + secrets aléatoires (n'écrase jamais)
make osrm-prepare   # télécharge l'extrait Bénin + extract/partition/customize (FORCE=1 pour retraiter)
make up             # démarre PostGIS, Redis, OSRM et attend qu'ils soient healthy
make check          # vérifie healthchecks, PostGIS_Version(), Redis, OSRM /route et /table sur Cotonou
make ps | logs s=osrm | db-shell | redis-cli | down

# Backend (Go)
make tools          # installe goose, sqlc et golangci-lint (versions figées)
make run            # lance l'API sur l'hôte avec les variables de .env
make build          # compile Backend/bin/api
make test           # tests unitaires + intégration (testcontainers, Docker requis), avec -race
make lint           # golangci-lint (formatage gci + gofumpt vérifié)
make sqlc           # régénère internal/store/dbgen depuis db/queries
make migrate-up | migrate-down | migrate-status | migrate-new name=add_x
make api-up         # API dans Docker (profil compose « api »), healthcheck sur /readyz
```

Ports hôte (liés à 127.0.0.1, surchargeables dans `.env`) : PostGIS **5440**, Redis **6390**, OSRM **5000**, API **8080**, Vite **5173**. Les ports 5432 et 6379 sont déjà pris sur la machine de dev.

## Algorithme de recherche (détail : ARCHITECTURE §4)

1. **Cache** Redis devant tout : clé = cellule H3 res 8 + produit (+ génération), TTL court (60 s). Toute mise à jour de stock, de statut ou de position invalide le cache.
2. **Rayons progressifs** avec `ST_DWithin` : 500 m, 1, 2, 5, 10, 25, 50 km, sur les stations `approved`, **ouvertes**, avec `stock > 0` frais (≤ 24 h). On s'arrête au premier rayon qui donne `SEARCH_MIN_RESULTS` candidats.
3. **Repli sur les fermées** : s'il n'y a aucune station ouverte à 50 km, on renvoie les plus proches fermées avec leur `reopensAt`.
4. **Repli KNN illimité** si rien du tout : `ORDER BY location <-> point LIMIT 10`. Il y a donc toujours un résultat dès qu'une station du pays a un stock frais.
5. **Re-classement** par temps de trajet réel via OSRM `/table` (1 source → N). Si OSRM est en panne ou en timeout : ordre par distance + `ranking: "distance"`.
6. Chaque résultat porte `stockUpdatedAt` (le client affiche « mis à jour il y a X min ») et `stale` (8 h à 24 h).

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
  - `internal/config` : config depuis l'environnement, validée, échec explicite.
  - `internal/apperr` : erreurs typées et codes stables.
  - `internal/http/{router,middleware,handler,respond,httpctx}` : routeur chi, middlewares, handlers qui renvoient `error`, rendu JSON et problem+json, valeurs de contexte (request ID, IP client).
  - `internal/store` : transactions (`InTx`) et traduction des erreurs pgx ; `internal/store/dbgen` contient le code **généré** par sqlc, à ne jamais éditer.
  - `internal/platform/{postgres,redis,osrm,h3,logging}` : clients d'infrastructure ; `internal/ratelimit` : fenêtre glissante Redis.
  - `internal/<domaine>/` pour la logique métier, à partir de l'étape 3.
  - `db/migrations/` (goose, `YYYYMMDDHHMMSS_desc.sql` en **UTC**, créées par `make migrate-new`, toujours avec un Down, une migration de données à part) et `db/queries/` (sqlc). Les migrations sont embarquées (`db.Migrations`) pour les tests. Après modification d'une requête : `make sqlc`.
  - Piège SQL : un `CHECK` évalué à NULL passe. Toute condition sur une colonne nullable doit donc tester `IS NOT NULL` explicitement.
- **Injection de dépendances explicite** : constructeurs `NewXxx(deps…)`, aucune variable globale mutable, pas d'`init()` qui configure quoi que ce soit, `context.Context` partout.
- **sqlc** : le type `geography` n'est jamais exposé. Les requêtes prennent `lat`/`lng` en `float8` (`ST_MakePoint(lng, lat)`) et lisent les colonnes générées `stations.lat`/`lng` (une expression `ST_Y(...)` serait typée non nullable par sqlc). Colonnes explicites (pas de `SELECT *`).
- **SQL** : `snake_case` ; tables au pluriel ; PK `id uuid DEFAULT uuidv7()` (sauf référentiels en `smallint identity`) ; FK `<entite>_id` ; horodatages `timestamptz` suffixés `_at`, en UTC ; enums PostgreSQL ; contraintes nommées `pk_ fk_ uq_ ck_ idx_<table>_<cols>`. Requêtes sqlc : `GetStationByID`, `ListStationsWithinRadius`, `UpsertStationStock`.
- **API** : REST JSON sous `/api/v1` ; ressources au pluriel en kebab-case (`/opening-hours`) ; clés JSON en camelCase ; dates RFC 3339 UTC ; coordonnées `{ "lat", "lng" }`. Attention : PostGIS et OSRM attendent l'ordre **lng, lat**. Pagination par curseur `?limit=&cursor=` → `{ items, nextCursor }`.
- **TypeScript** : fichiers kebab-case (`station-card.tsx`), composants PascalCase, hooks `useXxx`, stores Zustand `useXxxStore`, schémas zod `xxxSchema` + `type Xxx = z.infer<…>`, fabriques de query keys par domaine (`stationKeys.detail(id)`).

### Gestion des erreurs
- **Go** : toute erreur est traitée ou remontée avec contexte : `fmt.Errorf("station.UpdateStock: %w", err)` ; utiliser `errors.Is` / `errors.As`.
- Les erreurs métier sont typées dans `internal/apperr` (`Code`, `Status`, `Message`, `Fields`). Le store convertit `pgx.ErrNoRows` → `NotFound` et `23505` → `Conflict`.
- Un seul point de rendu HTTP : les handlers renvoient une `error`, le middleware répond en **RFC 9457** `application/problem+json` `{ type, title, status, detail, code, requestId, errors?[{ field, message }] }`. Le `code` est stable (`station.not_approved`), le client le traduit en message français.
- Une 5xx renvoie un message générique au client et un log complet via slog (`request_id`, `user_id`, `route`). Jamais de mot de passe, de token, de coordonnées ni de document dans les logs. Middleware `recover` pour les panics.
- Les appels externes (OSRM, Expo Push) passent par `context` avec timeout et basculent en mode dégradé plutôt qu'en échec.
- JSON entrant : `DisallowUnknownFields`, taille de corps bornée, validation au handler.
- **Clients** : réponses API validées par zod ; erreurs typées `ApiError` (issues de problem+json) ; retry TanStack Query seulement sur erreur réseau ou 5xx ; error boundary par écran ; jamais de message technique brut affiché.

### Tests
- **Go** : `go test -race ./...`. Tests unitaires en table pour la logique métier (classement de la recherche, horaires d'ouverture, rappels, clés H3, rotation des tokens).
- Tests d'intégration sous build tag `integration`, contre un vrai PostGIS et un vrai Redis via testcontainers-go, avec les **mêmes images que le compose** (`POSTGIS_IMAGE`, `REDIS_IMAGE`). Pas de mock SQL. Handlers testés avec `httptest`, client OSRM avec un serveur `httptest`. `make test` lance unitaires + intégration.
- Objectif ≥ 80 % de couverture sur `internal/search` et `internal/auth`.
- **Mobile** : jest-expo + React Native Testing Library ; E2E Maestro (recherche → itinéraire, mise à jour de stock par le gérant).
- **Web** : Vitest + Testing Library ; E2E Playwright (validation d'un gérant).
- Tout correctif de bug s'accompagne d'un test de régression. Lint : golangci-lint, ESLint + Prettier, `tsc --noEmit`.

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
- **Position** : utilisée en mémoire le temps de la requête, puis oubliée. Le cache est indexé par cellule H3 res 8 (≈ 0,74 km²), jamais par coordonnées. Les stats sont agrégées par cellule H3 res 7 et par heure, affichées seulement au-delà d'un seuil k ≥ 5.
- **Consentement** : écran explicatif avant la permission système. L'app reste utilisable sans localisation (choix d'un point sur la carte).
- **Suppression de compte** depuis l'app (`DELETE /me`) : désactivation immédiate, purge sous 30 jours.
- **Justificatifs IFU** chiffrés (AES-256-GCM, chiffrement par enveloppe) ; chaque consultation par un admin est auditée.
- **Durées de conservation** : voir ARCHITECTURE §8 (à valider avec un juriste ou DPO avant la mise en production) ; purge par job planifié.
- Déclaration du traitement auprès de l'APDP avant la prod. Politique de confidentialité versionnée, acceptée à l'inscription.
