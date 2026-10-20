# GoStation

Trouver la station la plus proche qui a **en stock** le produit recherché (gaz domestique par taille de bouteille, essence, gasoil), puis s'y rendre via une carte intégrée. Bénin.

| Dossier | Contenu | État |
|---|---|---|
| `Backend/` | API Go (chi, pgx/sqlc, goose, Redis, asynq) et worker : auth et rôles, stations et stocks, recherche et itinéraire (OSRM), notifications et rappels, signalements, favoris, API admin, droits des personnes et purges ; spec [OpenAPI 3.1](Backend/api/openapi.yaml) | ✔ V1 complète |
| `Mobile/` | App Expo React Native unique (utilisateur + gérant) : recherche, carte, guidage, compte, favoris, signalements, espace gérant, push, « Mes données » ; [design system](Mobile/docs/design-system.md), [perf](Mobile/docs/performance.md) | ✔ Android (builds EAS `preview`) ; iOS jamais construit |
| `Web/` | Admin React (Vite, Tailwind, shadcn/ui) : connexion + 2FA, tableau de bord, stations, carte, signalements, comptes, catalogue, stats et pénuries, audit, exports, demandes de données ; [design system](Web/docs/design-system.md) | ✔ toutes les sections |
| `docs/` | [Architecture](docs/ARCHITECTURE.md) (modèle de données, endpoints, algorithme, décisions), [état des lieux](docs/STATUS.md), [textes légaux](docs/legal/) (projets) | ✔ |
| `scripts/` | Préparation OSRM, vérification de l'infra, `.env`, pile E2E isolée, plans et bench de la recherche et des stats | ✔ |

Conventions et règles du projet : [`CLAUDE.md`](CLAUDE.md).

## Démarrage rapide

Prérequis : Docker Engine avec Compose v2, `make`, `curl`, `openssl`, et pour le backend Go 1.27 + gcc (cgo, pour h3-go). Environ 1 Go de disque pour les images et les données OSRM.

```bash
make env            # 1. crée .env avec des secrets aléatoires
make osrm-prepare   # 2. télécharge l'extrait Bénin (~48 Mo) et prépare le routage (~1 min)
make up             # 3. démarre PostGIS, Redis, OSRM et Mailpit, attend les healthchecks
make check          # 4. vérifie PostGIS, Redis et un itinéraire OSRM à Cotonou
```

Résultat attendu de `make check` :

```
✔ postgres : healthy
✔ redis : healthy
✔ osrm : healthy
✔ PostgreSQL 18.x — PostGIS_Version() = 3.6 …
✔ Redis : PONG (maxmemory-policy=noeviction)
✔ OSRM /route aéroport → Dantokpa : 6.4 km, 12 min
✔ OSRM /table depuis l'aéroport (s) → Dantokpa, Akpakpa, Fidjrossè : …
✔ Infra opérationnelle.
```

## Backend Go

### Outillage

```bash
sudo snap install go --channel=1.27/stable --classic   # Go 1.27 (apt d'Ubuntu 26.04 s'arrête à 1.26)
make tools                                             # goose, sqlc, golangci-lint dans $(go env GOBIN)
```

| Outil | Version | Installation (`make tools`) | Usage |
|---|---|---|---|
| goose | v3.28.0 | `go install github.com/pressly/goose/v3/cmd/goose@v3.28.0` | Migrations SQL (`Backend/db/migrations`) |
| sqlc | v1.31.1 | `go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1` | Génère `internal/store/dbgen` depuis `db/queries` (cgo, compilation longue) |
| golangci-lint | v2.14.0 | `go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.14.0` | Lint et formatage (gci + gofumpt) |

`$(go env GOBIN)` (ou `$(go env GOPATH)/bin`) doit être dans le `PATH` pour appeler les outils directement ; le Makefile, lui, les trouve tout seul.

### Lancer l'API

```bash
make up && make migrate-up   # infra + schéma
make run                     # API sur http://127.0.0.1:8080 (variables de .env)
make worker-run              # dans un autre terminal : worker asynq (emails, push, rappels, stats, exports)
# ou, dans Docker (image distroless non-root, healthchecks sur /readyz) :
make api-up                  # API + worker
curl -s localhost:8080/readyz   # {"status":"ready","checks":{"osrm":"ok","postgres":"ok","redis":"ok"}}
```

Sans worker, l'API fonctionne mais les emails, les push et les alertes restent en file dans Redis : ils partent dès que le worker démarre. Le worker tourne en **une seule instance** (son scheduler lance les tâches périodiques). Les files se supervisent dans asynqmon : <http://127.0.0.1:8090>.

| Commande | Effet |
|---|---|
| `make test` | Tests unitaires + intégration avec `-race` (testcontainers : PostGIS et Redis jetables, mêmes images que le compose) |
| `make test-unit` | Tests unitaires seuls, sans Docker |
| `make lint` / `make fmt` | golangci-lint / formatage |
| `make sqlc` | Régénère le code d'accès aux données après modification de `db/queries` |
| `make migrate-up` / `migrate-down` / `migrate-status` | Migrations sur la base de `.env` |
| `make migrate-new name=add_x` | Nouvelle migration horodatée (UTC) dans `Backend/db/migrations` |
| `make build` | Binaires `Backend/bin/api` et `Backend/bin/worker` |
| `make worker-run` / `make worker-up` | Worker asynq sur l'hôte / dans Docker |

Endpoints : voir [ARCHITECTURE §5](docs/ARCHITECTURE.md) et la spec OpenAPI. Les erreurs sont en `application/problem+json` (RFC 9457), avec des codes stables.

### Authentification

- **Emails de dev** : tous les emails (codes de vérification, réinitialisation) sont capturés par Mailpit : <http://127.0.0.1:8025>.
- **Créer un admin** (aucune route publique ne le permet) : `make admin-create email=ada@gostation.bj first=Ada last=Admin`. Le mot de passe est saisi au clavier, deux fois. La 2FA TOTP est configurée au premier login (`POST /api/v1/auth/admin/login` puis `/auth/admin/2fa`).
- **2FA perdue** : `make admin-reset-2fa email=…`.
- **API admin** : toutes les routes `/api/v1/admin/*` n'acceptent que la session web (cookies posés par `/auth/admin/2fa`) et le jeton CSRF (`X-CSRF-Token`) sur les écritures ; un Bearer y est refusé. Les exports sont générés par le worker (API et worker partagent le volume `documents`) et supprimés 24 h après leur génération.
- **Nouvelles variables** après un `git pull` : `make env-sync` complète `.env` sans toucher aux valeurs existantes.

### Admin web

```bash
cd Web && npm install
npm run dev          # http://localhost:5173, proxy /api vers l'API (make api-up ou make run)
```

Se connecter avec un admin créé par `make admin-create` ; la première connexion fait configurer la 2FA (QR code, puis 10 codes de secours à sauvegarder). En dev, la page `/design` présente tous les tokens et composants. Tests : `npm test` (Vitest), `npm run e2e` (Playwright sur le build de production, crée son propre admin), `npm run screenshots` (captures de `Web/docs/screenshots/`). Détails et règles : [CLAUDE.md](CLAUDE.md), [ARCHITECTURE §9](docs/ARCHITECTURE.md) (D41 à D45).

### Notifications push

`EXPO_ACCESS_TOKEN` est facultatif : vide, les push passent par un Pusher factice qui journalise seulement le type de notification (`push: fake delivery`). Pour de vrais push, renseigner le token d'accès Expo (sécurité renforcée des push activée sur le projet EAS). Les reçus Expo sont lus 15 min après l'envoi ; un appareil désinstallé (`DeviceNotRegistered`) est supprimé.

### Recherche et stats admin : données fictives et bench

```bash
make seed-dev        # 5 000 stations fictives (is_demo = true) + 30 jours de stats de recherche (dev uniquement)
make explain-search  # plans EXPLAIN ANALYZE des requêtes de recherche (index GiST vérifié)
make bench           # k6 (image grafana/k6:1.3.0) : 100 req/s pendant 60 s depuis 5 zones
DURATION=120s RATE=200 make bench
make explain-stats   # plans des stats admin (agrégats journaliers et tous lieux, index de search_stats)
make bench-stats     # p50/p95/p99 du tableau de bord, des stats et des cartes (échoue si un p95 > 300 ms)
```

`make bench` lance une API dédiée sur le port 18080 (quotas levés, logs en `warn`), vide le cache de recherche, puis rapporte p50/p95/p99 : HTTP de bout en bout, temps serveur hors OSRM (avec et sans cache), OSRM à part, taux de cache. Les résultats JSON complets vont dans `bench/results/` (ignoré par git). `RESET=1 make seed-dev` supprime les stations fictives.

**Contrat d'API** : [`Backend/api/openapi.yaml`](Backend/api/openapi.yaml) (OpenAPI 3.1). Les types TypeScript des clients se régénèrent avec `npm run gen:api` (dans `Web/` et `Mobile/`).

### App mobile

```bash
cd Mobile && npm install
npm run android      # compile et installe le dev build (MapLibre est natif : pas d'Expo Go), puis Metro
adb reverse tcp:8080 tcp:8080 && adb reverse tcp:8081 tcp:8081   # API et Metro vus du téléphone
```

URL de l'API : `EXPO_PUBLIC_API_URL` (`Mobile/.env`, `http://127.0.0.1:8080` par défaut). Tests : `npm test` (Jest), `npm run e2e` (Maestro sur la pile isolée, build release installé). Builds : profils EAS `development`, `preview` (APK) et `production` (AAB), voir [CLAUDE.md](CLAUDE.md) (règles mobile).

## Services locaux

Exposés uniquement sur `127.0.0.1` ; ports modifiables dans `.env`.

| Service | Image | Port hôte | Accès |
|---|---|---|---|
| PostgreSQL + PostGIS | `postgis/postgis:18-3.6` | 5440 | `make db-shell` ou `DATABASE_URL` dans `.env` |
| Redis | `redis:8.10.2-alpine` | 6390 | `make redis-cli` (mot de passe requis) |
| OSRM (car, MLD) | `ghcr.io/project-osrm/osrm-backend:v26.10.0-debian` | 5000 | `curl "http://127.0.0.1:5000/route/v1/driving/2.3844,6.3573;2.4300,6.3730"` |
| API (profil `api`) | `gostation-api` (build `Backend/Dockerfile`) | 8080 | `make api-up`, puis `curl localhost:8080/readyz` |
| Worker (profil `api`) | `gostation-api`, entrypoint `/app/worker` | — | `make worker-up` ; une seule instance |
| asynqmon (profil `dev`) | `hibiken/asynqmon:0.7.2` | 8090 | <http://127.0.0.1:8090> |
| Mailpit (profil `dev`) | `axllent/mailpit:v1.31.6` | 1025 (SMTP), 8025 (web) | <http://127.0.0.1:8025> |

## Commandes

| Commande | Effet |
|---|---|
| `make up` / `make down` | Démarrer / arrêter (les volumes sont conservés) |
| `make ps` | État et healthchecks |
| `make logs` / `make logs s=osrm` | Logs de tous les services / d'un seul |
| `make db-shell` | psql dans PostGIS |
| `make redis-cli` | redis-cli authentifié |
| `make osrm-prepare` | (Re)prépare OSRM si l'extrait Geofabrik a changé ; `FORCE=1` pour forcer |
| `make check` | Vérification complète de l'infra |

**Mettre à jour la carte routière** : relancer `make osrm-prepare`. Le script retélécharge l'extrait si son MD5 a changé, retraite les données dans un répertoire de staging, publie le résultat seulement en cas de succès et redémarre `osrm`.

## Dépannage

- **`make up` échoue sur `osrm`** : les données ne sont pas préparées. Lancer `make osrm-prepare`.
- **Port déjà utilisé** : changer `POSTGRES_PORT`, `REDIS_PORT` ou `OSRM_PORT` dans `.env`, puis répercuter le port dans `DATABASE_URL`, `REDIS_URL` et `OSRM_URL`.
- **Repartir de zéro** (⚠ supprime les données locales) : `docker compose down -v`, puis reprendre le démarrage rapide.
