# GoStation

Trouver la station la plus proche qui a **en stock** le produit recherché (gaz domestique par taille de bouteille, essence, gasoil), puis s'y rendre via une carte intégrée. Bénin.

| Dossier | Contenu | État |
|---|---|---|
| `Backend/` | API Go (chi, pgx/sqlc, goose, Redis, asynq) | à initialiser |
| `Mobile/` | App Expo React Native (user + gérant) | à initialiser |
| `Web/` | Admin React (Vite, Tailwind, shadcn/ui) | à initialiser |
| `docs/` | [Architecture](docs/ARCHITECTURE.md) : modèle de données, endpoints, algorithme de recherche | ✔ |
| `scripts/` | Préparation OSRM, vérification de l'infra | ✔ |

Conventions et règles du projet : [`CLAUDE.md`](CLAUDE.md).

## Démarrage rapide

Prérequis : Docker Engine avec Compose v2, `make`, `curl`, `openssl`. Environ 1 Go de disque pour les images et les données OSRM.

```bash
make env            # 1. crée .env avec des secrets aléatoires
make osrm-prepare   # 2. télécharge l'extrait Bénin (~48 Mo) et prépare le routage (~1 min)
make up             # 3. démarre PostGIS, Redis, OSRM et attend les healthchecks
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

## Services locaux

Exposés uniquement sur `127.0.0.1` ; ports modifiables dans `.env`.

| Service | Image | Port hôte | Accès |
|---|---|---|---|
| PostgreSQL + PostGIS | `postgis/postgis:18-3.6` | 5440 | `make db-shell` ou `DATABASE_URL` dans `.env` |
| Redis | `redis:8.10.2-alpine` | 6390 | `make redis-cli` (mot de passe requis) |
| OSRM (car, MLD) | `ghcr.io/project-osrm/osrm-backend:v26.10.0-debian` | 5000 | `curl "http://127.0.0.1:5000/route/v1/driving/2.3844,6.3573;2.4300,6.3730"` |

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
