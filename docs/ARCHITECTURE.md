# GoStation — Architecture

> Document prévisionnel (étape 0 : fondations). Il fixe les choix structurants avant le code ; il évoluera avec les migrations goose et les specs d'API.
> Conventions et règles transverses : [`CLAUDE.md`](../CLAUDE.md).

**Sommaire** : 1. Vue d'ensemble · 2. Composants · 3. Modèle de données · 4. Algorithme de recherche · 5. Endpoints API · 6. Authentification et sécurité · 7. Jobs asynchrones · 8. Données personnelles et conservation · 9. Questions ouvertes

---

## 1. Vue d'ensemble

```mermaid
flowchart LR
  subgraph Clients
    MOB["App mobile<br/>Expo React Native<br/>user · manager"]
    WEB["Admin web<br/>Vite + React"]
  end

  subgraph Externes["Services externes"]
    OFM["OpenFreeMap<br/>tuiles vectorielles"]
    EXPO["Expo Push Service<br/>→ FCM / APNs"]
  end

  subgraph Plateforme["Plateforme GoStation"]
    API["API Go<br/>chi · REST /api/v1"]
    WRK["Worker Go<br/>asynq"]
    PG[("PostgreSQL 18<br/>+ PostGIS 3.6")]
    RDS[("Redis 8<br/>cache H3 · refresh tokens<br/>files asynq · compteurs")]
    OSRM["OSRM v26<br/>Bénin · car · MLD"]
    DOCS[("Stockage objets<br/>justificatifs chiffrés")]
  end

  MOB -- "HTTPS JSON + JWT" --> API
  WEB -- "HTTPS JSON + JWT<br/>(refresh en cookie httpOnly)" --> API
  MOB -. "tuiles" .-> OFM
  WEB -. "tuiles" .-> OFM

  API -- "SQL (pgx)" --> PG
  API -- "cache · tokens · enqueue" --> RDS
  API -- "/table · /route" --> OSRM
  API -- "AES-256-GCM" --> DOCS

  RDS -- "dequeue" --> WRK
  WRK --> PG
  WRK -- "push" --> EXPO
  EXPO -. "notifications" .-> MOB
```

Principes :
- **Un seul binaire Go, deux points d'entrée** (`cmd/api`, `cmd/worker`) qui partagent `internal/`. L'API est sans état : on la scale horizontalement.
- **OSRM n'est jamais exposé publiquement** : l'API le proxifie (`/routes`), ce qui permet le rate limiting et garantit qu'aucune position n'est journalisée.
- **Les tuiles OpenFreeMap sont chargées directement par les clients** (pas de proxy).
- **Le stockage des justificatifs** est un système de fichiers local en dev et un stockage objet compatible S3 en prod (§9, Q5).

## 2. Composants

| Composant | Rôle | Techno |
|---|---|---|
| API | Auth, recherche, gestion des stations et des stocks, back-office admin | Go, chi, pgx v5 + sqlc, go-redis v9, golang-jwt v5, h3-go v4, slog |
| Worker | Rappels de stock, envoi des push, agrégation des stats, purges de conservation, exports de données | asynq (Redis) |
| PostgreSQL + PostGIS | Source de vérité ; requêtes spatiales (`ST_DWithin`, KNN `<->`) | PG 18, PostGIS 3.6, migrations goose |
| Redis | Cache de recherche (H3 + produit), refresh tokens, files asynq, rate limiting, compteurs de stats | Redis 8.10, `noeviction` |
| OSRM | Matrice de temps de trajet (`/table`) et itinéraire (`/route`) | osrm-backend v26.10, MLD |
| Mobile | Recherche, carte, itinéraire (user) ; station, horaires, stocks (manager) | Expo SDK 57, MapLibre RN, TanStack Query, Zustand |
| Web admin | Validation, catalogue, carte, pénuries, signalements, stats, audit, demandes APDP | Vite, React 19, Tailwind 4, shadcn/ui, 21st.dev, TanStack Router/Query, maplibre-gl |

## 3. Modèle de données

Conventions : PK `uuid DEFAULT uuidv7()` (natif PG 18, triable dans le temps), `timestamptz` en UTC, enums PostgreSQL, contraintes nommées. Extensions : `postgis`, `citext`.

```mermaid
erDiagram
  users ||--o| stations : "gère"
  users ||--o{ device_tokens : "possède"
  users ||--o{ reports : "signale"
  users ||--o{ data_requests : "demande"
  users ||--o{ audit_logs : "agit"
  users ||--o{ favorites : "met en favori"
  users ||--o{ admin_recovery_codes : "secours 2FA"
  stations ||--o{ favorites : "favorite"
  stations ||--o{ station_opening_hours : "horaires"
  stations ||--o{ station_stocks : "stocke"
  stations ||--o{ stock_history : "historise"
  stations ||--o{ reports : "concerne"
  products ||--o{ station_stocks : "référence"
  products ||--o{ stock_history : "référence"
  products ||--o{ search_stats : "agrège"

  users {
    uuid id PK
    user_role role
    user_status status
    citext email UK
    text password_hash
  }
  stations {
    uuid id PK
    uuid manager_id FK
    station_status status
    char ifu
    geography location
    bigint h3_r8
  }
  products {
    smallint id PK
    text code UK
    product_kind kind
    numeric size_kg
  }
  station_stocks {
    uuid station_id PK
    smallint product_id PK
    int quantity
    timestamptz updated_at
  }
  stock_history {
    bigint id PK
    uuid station_id FK
    smallint product_id FK
    int quantity
  }
  station_opening_hours {
    uuid station_id PK
    smallint weekday PK
    time opens_at PK
    time closes_at
  }
  device_tokens {
    uuid id PK
    uuid user_id FK
    text token UK
  }
  reports {
    uuid id PK
    uuid station_id FK
    report_reason reason
    report_status status
  }
  audit_logs {
    bigint id PK
    uuid actor_id FK
    text action
    jsonb metadata
  }
  data_requests {
    uuid id PK
    uuid user_id FK
    data_request_type type
    data_request_status status
  }
  search_stats {
    timestamptz bucket PK
    bigint h3_r7 PK
    smallint product_id PK
    int searches
  }
  favorites {
    uuid user_id PK
    uuid station_id PK
    timestamptz created_at
  }
  admin_recovery_codes {
    uuid id PK
    uuid user_id FK
    bytea code_hash
    timestamptz used_at
  }
```

### 3.1 Types énumérés

```sql
CREATE TYPE user_role           AS ENUM ('user', 'manager', 'admin');
CREATE TYPE user_status         AS ENUM ('active', 'disabled', 'pending_deletion');
CREATE TYPE station_status      AS ENUM ('pending', 'approved', 'rejected', 'suspended');
CREATE TYPE product_kind        AS ENUM ('lpg', 'petrol', 'diesel');   -- gaz domestique, essence, gasoil
CREATE TYPE product_unit        AS ENUM ('cylinder', 'liter');
CREATE TYPE stock_source        AS ENUM ('manager', 'admin', 'system');
CREATE TYPE report_reason       AS ENUM ('stock_incorrect', 'station_closed', 'wrong_location', 'other');
CREATE TYPE report_status       AS ENUM ('open', 'resolved', 'dismissed');
CREATE TYPE data_request_type   AS ENUM ('access', 'export', 'rectification', 'deletion', 'opposition');
CREATE TYPE data_request_status AS ENUM ('pending', 'in_progress', 'completed', 'rejected');
CREATE TYPE device_platform     AS ENUM ('ios', 'android');
```

### 3.2 Tables

```sql
-- Comptes (les trois rôles). Aucune position, aucun téléphone personnel.
CREATE TABLE users (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  role                    user_role   NOT NULL DEFAULT 'user',
  status                  user_status NOT NULL DEFAULT 'active',
  email                   citext      NOT NULL,
  password_hash           text        NOT NULL,             -- argon2id, format PHC (params inclus)
  first_name              text        NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 100),
  last_name               text        NOT NULL CHECK (char_length(last_name)  BETWEEN 1 AND 100),
  email_verified_at       timestamptz,
  privacy_policy_version  text        NOT NULL,             -- version acceptée à l'inscription
  privacy_accepted_at     timestamptz NOT NULL,
  last_login_at           timestamptz,
  deletion_requested_at   timestamptz,                      -- purge définitive à +30 j (job)
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_users_email UNIQUE (email)
);

-- Stations. V1 : un gérant = une station.
CREATE TABLE stations (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  manager_id            uuid REFERENCES users(id) ON DELETE SET NULL,
  status                station_status NOT NULL DEFAULT 'pending',
  name                  text NOT NULL,
  brand                 text,                                -- marque, normalisée par l'admin
  ifu                   char(13) NOT NULL CHECK (ifu ~ '^[0-9]{13}$'),
  rccm                  text NOT NULL,                       -- format validé côté API
  address               text NOT NULL,
  city                  text,
  phone                 text NOT NULL,                       -- E.164 (+229…)
  location              geography(Point, 4326),              -- NULL tant que non épinglée
  lat                   double precision GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED,
  lng                   double precision GENERATED ALWAYS AS (ST_X(location::geometry)) STORED,
  location_set_at       timestamptz,
  h3_r8                 bigint,                              -- cellule H3 res 8 (h3-go), stats et pénuries
  document_object_key   text,                                -- justificatif chiffré (stockage objet)
  document_wrapped_key  bytea,                               -- DEK chiffrée par la KEK (enveloppe)
  document_sha256       bytea,
  document_mime         text CHECK (document_mime IN ('application/pdf', 'image/jpeg', 'image/png')),
  status_reason         text,                                -- motif de rejet ou de suspension
  reviewed_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  last_stock_update_at  timestamptz,                         -- dénormalisé : données périmées et rappels
  last_reminder_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_stations_manager UNIQUE (manager_id)
);
-- Index spatial partiel : ne couvre que ce que la recherche peut renvoyer.
CREATE INDEX idx_stations_location_approved ON stations USING gist (location)
  WHERE status = 'approved' AND location IS NOT NULL;
CREATE INDEX idx_stations_status  ON stations (status, created_at DESC);
CREATE INDEX idx_stations_ifu     ON stations (ifu);           -- non unique : un IFU peut couvrir un réseau (§9)
-- Données périmées (admin) et rappels : stations approuvées triées par fraîcheur.
CREATE INDEX idx_stations_last_stock_update ON stations (last_stock_update_at)
  WHERE status = 'approved';

-- Horaires (ISO 8601 : 1 = lundi). 24 h/24 : 00:00 → 24:00. closes_at < opens_at = passe minuit.
CREATE TABLE station_opening_hours (
  station_id  uuid     NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  opens_at    time     NOT NULL,
  closes_at   time     NOT NULL,
  PRIMARY KEY (station_id, weekday, opens_at)
);

-- Catalogue configurable par l'admin (tailles de gaz). Jamais supprimé : désactivé.
CREATE TABLE products (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,                    -- 'lpg_6kg', 'lpg_12_5kg', 'petrol', 'diesel'
  kind        product_kind NOT NULL,
  unit        product_unit NOT NULL,
  size_kg     numeric(5,2),
  label_fr    text NOT NULL,                           -- « Gaz 12,5 kg »
  is_active   boolean  NOT NULL DEFAULT true,
  sort_order  smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_products_kind_unit CHECK (
    (kind = 'lpg' AND unit = 'cylinder' AND size_kg IS NOT NULL AND size_kg > 0)
    OR (kind IN ('petrol', 'diesel') AND unit = 'liter' AND size_kg IS NULL)),
  CONSTRAINT uq_products_kind_size UNIQUE NULLS NOT DISTINCT (kind, size_kg)
);

-- Stock courant : bouteilles (gaz) ou litres (carburants).
CREATE TABLE station_stocks (
  station_id  uuid     NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  product_id  smallint NOT NULL REFERENCES products(id),
  quantity    integer  NOT NULL CHECK (quantity >= 0),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),       -- « mis à jour il y a X min »
  PRIMARY KEY (station_id, product_id)
);
CREATE INDEX idx_station_stocks_available ON station_stocks (product_id, station_id)
  WHERE quantity > 0;
CREATE INDEX idx_station_stocks_updated_at ON station_stocks (updated_at);  -- stale (> 8 h) / expiré (> 24 h)

-- Historique des stocks : écrit dans la même transaction que station_stocks (pas de trigger).
CREATE TABLE stock_history (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  station_id         uuid     NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  product_id         smallint NOT NULL REFERENCES products(id),
  quantity           integer  NOT NULL,
  previous_quantity  integer,
  source             stock_source NOT NULL,
  changed_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_history_station ON stock_history (station_id, product_id, created_at DESC);
-- Partitionnement mensuel (RANGE created_at) quand on dépasse ~10 M lignes.

-- Tokens push Expo. Supprimés à la déconnexion, quand Expo renvoie DeviceNotRegistered, ou après 90 j sans activité.
CREATE TABLE device_tokens (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         text NOT NULL UNIQUE,                  -- ExponentPushToken[…]
  platform      device_platform NOT NULL,
  app_version   text,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_device_tokens_user ON device_tokens (user_id);

-- Signalements des utilisateurs.
CREATE TABLE reports (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  station_id       uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  product_id       smallint REFERENCES products(id),
  reporter_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  reason           report_reason NOT NULL,
  comment          text CHECK (char_length(comment) <= 500),
  status           report_status NOT NULL DEFAULT 'open',
  resolved_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution_note  text,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_open    ON reports (created_at DESC) WHERE status = 'open';
CREATE INDEX idx_reports_station ON reports (station_id, created_at DESC);

-- Journal d'audit, en ajout seul : le rôle applicatif n'a que INSERT et SELECT. La purge passe par un rôle dédié.
CREATE TABLE audit_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role   user_role,
  action       text NOT NULL,             -- 'station.approve', 'document.view', 'product.update', 'user.purge'…
  entity_type  text NOT NULL,
  entity_id    text,
  metadata     jsonb NOT NULL DEFAULT '{}', -- avant/après, sans donnée personnelle superflue
  request_id   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor  ON audit_logs (actor_id, created_at DESC);

-- Demandes d'exercice des droits (APDP / RGPD).
CREATE TABLE data_requests (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id            uuid REFERENCES users(id) ON DELETE SET NULL,
  type               data_request_type   NOT NULL,
  status             data_request_status NOT NULL DEFAULT 'pending',
  details            text,
  due_at             timestamptz NOT NULL,           -- échéance légale (délai à confirmer, §9)
  handled_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  response_note      text,
  export_object_key  text,                           -- archive chiffrée, lien expirant
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);
CREATE INDEX idx_data_requests_status ON data_requests (status, due_at);

-- Ajout : stats de recherche anonymes, la seule trace des recherches.
-- Les compteurs vivent dans Redis (HINCRBY) et sont vidés ici toutes les 5 min par le worker.
CREATE TABLE search_stats (
  bucket          timestamptz NOT NULL,             -- heure tronquée
  h3_r7           bigint      NOT NULL,             -- cellule ≈ 5 km², jamais la position
  product_id      smallint    NOT NULL REFERENCES products(id),
  searches        integer     NOT NULL DEFAULT 0,
  empty_within_5km integer    NOT NULL DEFAULT 0,   -- aucun stock à ≤ 5 km : signal de pénurie
  PRIMARY KEY (bucket, h3_r7, product_id)
);

-- Auth (étape 3) : 2FA TOTP des admins et date de changement du mot de passe.
ALTER TABLE users
  ADD COLUMN password_changed_at    timestamptz,
  ADD COLUMN totp_secret_encrypted  bytea,        -- AES-256-GCM (clé dérivée d'APP_SECRET), lié à l'id
  ADD COLUMN totp_enabled_at        timestamptz,
  ADD CONSTRAINT ck_users_totp CHECK ((totp_secret_encrypted IS NULL) = (totp_enabled_at IS NULL));

-- 10 codes de secours par admin : SHA-256 de codes à 80 bits d'entropie, usage unique.
CREATE TABLE admin_recovery_codes (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   bytea NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_admin_recovery_codes_code UNIQUE (user_id, code_hash)
);

-- Ajout (décision §9) : favoris, réservés aux utilisateurs connectés. Supprimés avec le compte.
CREATE TABLE favorites (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id  uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, station_id)
);
CREATE INDEX idx_favorites_station ON favorites (station_id);
```

**Colonnes `lat` / `lng` générées** : l'application ne lit jamais le type `geography`. Elle écrit `location` à partir de `lat`/`lng` (`ST_MakePoint(lng, lat)`) et lit les colonnes générées, que sqlc type correctement en `*float64` nullables. Une expression `ST_Y(...)` dans un SELECT serait typée non nullable par sqlc. `STORED` est imposé : PostgreSQL 18 interdit les fonctions d'extension dans une colonne virtuelle.

**Trigger `updated_at`** : une fonction `set_updated_at()` est appelée `BEFORE UPDATE` sur `users`, `stations`, `products` et `station_stocks`. Elle pose `now()`, sauf si la requête fixe elle-même `updated_at` (reprises de données, tests de péremption).

**Catalogue initial** (migration de données séparée) : gaz 5 kg, 10 kg et 25 kg (unité : bouteille), essence et gasoil (unité : litre). Tout est modifiable par l'admin.

## 4. Algorithme de recherche

**Entrée** : `productId`, `lat`, `lng` (position courante, jamais stockée). Endpoint **public**, sans compte, protégé par un rate limit par IP (Redis, fenêtre glissante).
**Sortie** : jusqu'à 10 stations `approved`, avec `quantity > 0`, **ouvertes maintenant** et dont le stock date de moins de 24 h, classées par temps de trajet réel. S'il n'y a aucune station ouverte à 50 km, on renvoie les plus proches fermées avec leur heure de réouverture.

**Fraîcheur du stock** (âge = `now() - station_stocks.updated_at`) :

| Âge | Effet |
|---|---|
| ≤ 8 h (`STOCK_STALE_AFTER`) | Normal |
| 8 h à 24 h | `stale: true` : badge « à vérifier » côté UI |
| > 24 h (`STOCK_EXPIRED_AFTER`) | Exclu de la recherche, listé dans `/admin/stale-stocks` |

**Ouverture** : calculée à partir de `station_opening_hours` dans le fuseau `APP_TIMEZONE` (`Africa/Porto-Novo`). Les plages qui passent minuit (`closes_at <= opens_at`) et le 24 h/24 (`00:00 → 24:00`) sont gérés. Le jour ISO et l'heure locale sont calculés en Go puis passés en paramètres SQL. Une station sans horaires renseignés n'apparaît pas, comme une station sans position.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client mobile
  participant A as API
  participant R as Redis
  participant P as PostGIS
  participant O as OSRM
  C->>A: GET /api/v1/search?productId&lat&lng (sans compte)
  A->>R: rate limit par IP (fenêtre glissante)
  A->>A: cell = H3(lat,lng, res 8) · compteur stats (cellule res 7)
  A->>R: GET search:v1:p{id}:g{gen}:c{cell}
  alt cache hit
    R-->>A: résultats classés
  else cache miss
    loop rayons 500 m → 50 km, stations ouvertes
      A->>P: ST_DWithin(centre de cellule, r + marge)
      P-->>A: candidats (≤ 20)
    end
    opt aucune station ouverte à 50 km
      A->>P: stations fermées à 50 km au plus
    end
    opt toujours rien
      A->>P: KNN ORDER BY location <-> point LIMIT 10
    end
    A->>O: /table 1 → N (sources=0)
    O-->>A: durées et distances routières
    A->>R: SET … EX 60
  end
  A->>A: distance et flag stale recalculés à la volée
  A-->>C: 200 résultats + stockUpdatedAt
```

### 4.1 Étapes

1. **Cache.** `cell = h3.LatLngToCell(lat, lng, 8)`. Clé : `search:v1:p{productId}:g{gen}:c{cell}`, où `gen = GET search:gen:p{productId}`. En cas de hit, on passe à l'étape 6.
   Le calcul se fait depuis le **centre de la cellule**, pas depuis la position exacte. Deux utilisateurs de la même cellule partagent donc le résultat, et la position précise n'entre jamais dans le calcul mis en cache.
2. **Rayons progressifs sur les stations ouvertes** `[500, 1000, 2000, 5000, 10000, 25000, 50000]` m. Chaque rayon est augmenté de la distance centre → sommet de la cellule (≈ 0,5 km en res 8) : ainsi aucune station située dans le rayon autour de la position réelle n'est manquée.
   ```sql
   -- name: ListAvailableStationsWithinRadius :many
   SELECT s.id, s.name, s.brand, s.address,
          ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng,
          ss.quantity, ss.updated_at AS stock_updated_at,
          ST_Distance(s.location, @point::geography) AS distance_m
   FROM stations s
   JOIN station_stocks ss ON ss.station_id = s.id
   WHERE ss.product_id = @product_id
     AND ss.quantity > 0
     AND ss.updated_at > now() - @expired_after::interval       -- STOCK_EXPIRED_AFTER (24 h)
     AND s.status = 'approved'
     AND s.location IS NOT NULL
     AND ST_DWithin(s.location, @point::geography, @radius_m)
     AND EXISTS (                                                -- ouverte maintenant
       SELECT 1 FROM station_opening_hours h
       WHERE h.station_id = s.id AND (
         (h.opens_at < h.closes_at AND h.weekday = @isodow
            AND @local_time >= h.opens_at AND @local_time < h.closes_at)
         OR (h.closes_at <= h.opens_at AND (                     -- plage qui passe minuit
            (h.weekday = @isodow      AND @local_time >= h.opens_at) OR
            (h.weekday = @prev_isodow AND @local_time <  h.closes_at)))))
   ORDER BY s.location <-> @point::geography
   LIMIT @max_candidates;                                        -- SEARCH_MAX_CANDIDATES = 20
   ```
   On s'arrête au premier rayon qui renvoie au moins `SEARCH_MIN_RESULTS` candidats (3 par défaut, pour que le re-classement OSRM ait du sens ; mettre 1 pour le comportement strict). Si le dernier rayon ne renvoie que 1 ou 2 candidats, on les garde.
   `@point` = `ST_SetSRID(ST_MakePoint(lng, lat), 4326)` : **lng d'abord**.
3. **Repli sur les stations fermées** si aucune station ouverte n'est trouvée à 50 km. Même requête, rayon 50 km, `LIMIT 10`, en remplaçant le filtre d'ouverture par « a des horaires mais n'est pas ouverte maintenant ». Pour chaque station, l'API calcule `reopensAt`, la prochaine ouverture d'après ses horaires. `strategy: "closed"`.
4. **Repli KNN illimité** si rien n'est trouvé à 50 km, même parmi les fermées. Requête sans `ST_DWithin` ni filtre d'ouverture, `ORDER BY location <-> point LIMIT 10` ; l'opérateur `<->` sur `geography` utilise l'index GiST. Les stations ouvertes passent en premier, les fermées portent leur `reopensAt`. `strategy: "knn"`. Il y a donc toujours un résultat tant qu'une station du pays a un stock frais. Sinon `strategy: "none"`, et l'UI propose d'autres tailles ou produits.
5. **Re-classement OSRM.** `GET /table/v1/driving/{lng,lat};{s1};…;{sN}?sources=0&annotations=duration,distance`, timeout `OSRM_TIMEOUT` (800 ms).
   - On trie par `duration` croissante. Une durée `null` (non joignable par la route) passe en fin de liste.
   - Si OSRM échoue ou dépasse le timeout, on garde l'ordre par distance, `ranking: "distance"`, et on ne met **pas** le résultat en cache.
   - On tronque à 10 résultats.
   - `SET` de la clé avec `EX = SEARCH_CACHE_TTL` (60 s).
6. **Réponse.** L'API recalcule en mémoire `distanceM` (haversine) depuis la position exacte, ainsi que `stale` à partir de `stockUpdatedAt`. La durée affichée est celle calculée depuis le centre de la cellule (≈), suffisante pour classer ; l'itinéraire précis vient de `/routes`.

### 4.2 Invalidation du cache

Toute écriture qui peut changer un résultat incrémente une **génération** : `INCR search:gen:p{productId}`. Les anciennes clés deviennent inaccessibles immédiatement et expirent par TTL. Sont concernées :
- mise à jour de stock (le produit concerné) ;
- changement de statut, de position ou d'horaires d'une station (tous les produits) ;
- l'ouverture et la fermeture des stations ne bumpent pas la génération : le TTL de 60 s borne le décalage aux heures d'ouverture.
- activation ou désactivation d'un produit.

On utilise des générations plutôt que `DEL` par motif, car une station qui repasse de 0 à > 0 doit apparaître dans des cellules dont le cache ne la contient pas encore ; un index inverse ne suffit pas. À l'échelle du Bénin (quelques milliers de stations), invalider tout le produit reste bon marché.
Évolution possible si le taux de hit baisse : une génération par cellule H3 res 5 et par produit, incrémentée sur le `gridDisk` couvrant 50 km autour de la station modifiée, plus une génération globale réservée aux résultats issus du repli KNN.

### 4.3 Réponse

```json
{
  "product": { "id": 2, "code": "lpg_12_5kg", "label": "Gaz 12,5 kg", "unit": "cylinder" },
  "strategy": "radius",
  "radiusM": 2000,
  "ranking": "duration",
  "results": [
    {
      "station": { "id": "0192…", "name": "Station Akpakpa", "brand": "…", "address": "…",
                   "location": { "lat": 6.3601, "lng": 2.4498 },
                   "isOpenNow": true, "reopensAt": null },
      "quantity": 14,
      "stockUpdatedAt": "2026-10-10T14:03:00Z",
      "stale": false,
      "distanceM": 1830,
      "durationS": 420,
      "routeDistanceM": 2400
    }
  ],
  "generatedAt": "2026-10-10T14:05:12Z"
}
```
`strategy` vaut `radius`, `closed`, `knn` ou `none`. « Mis à jour il y a X min » est calculé côté client à partir de `stockUpdatedAt` : le texte reste juste même quand la réponse vient du cache. `stale` signale un stock vieux de 8 à 24 h.

### 4.4 Points d'attention
- **Ordre des coordonnées** : JSON `{lat,lng}`, mais PostGIS (`ST_MakePoint`) et OSRM attendent `lng,lat`. Des tests unitaires dédiés couvrent ce point.
- **Lagune de Cotonou** : la distance à vol d'oiseau trompe souvent (il faut passer par les ponts), d'où le minimum de 3 candidats avant le re-classement.
- **Hors du Bénin** (frontières) : OSRM ne couvre que l'extrait ; on gère les durées `null` et le code `NoRoute` sans échouer.
- **Performance cible** : p95 < 150 ms sur miss, < 20 ms sur hit. Vérifier avec `EXPLAIN (ANALYZE, BUFFERS)` que l'index GiST partiel est bien utilisé.

## 5. Endpoints API

Préfixe `/api/v1`, JSON, erreurs RFC 9457. **Contrat de référence : [`Backend/api/openapi.yaml`](../Backend/api/openapi.yaml)** (OpenAPI 3.1, source des types des clients). Un test vérifie que la spec liste exactement les routes servies. ✅ = disponible ; les autres routes sont prévues. 🔒 = authentification requise (Bearer mobile, ou cookie + `X-CSRF-Token` pour l'admin web).

### Format des erreurs (RFC 9457)

Toute erreur est renvoyée en `application/problem+json`. Le champ `code` est **stable** : les clients s'appuient dessus pour afficher un message en français, jamais sur `title` ni `detail`, qui sont en anglais et destinés aux développeurs.

```json
{
  "type": "urn:gostation:problem:request.validation_failed",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/api/v1/search",
  "code": "request.validation_failed",
  "requestId": "01929b3e-7c41-7d2a-9f1e-3b8c2d4a5e6f",
  "errors": [{ "field": "lat", "code": "out_of_range", "message": "must be between -90 and 90" }]
}
```

| Code | HTTP | Sens |
|---|---|---|
| `request.invalid_json` | 400 | Corps JSON illisible ou champ inconnu |
| `request.invalid_parameter` | 400 | Paramètre de chemin ou de requête mal formé |
| `request.body_too_large` | 413 | Corps plus gros que `HTTP_MAX_BODY_BYTES` |
| `request.validation_failed` | 422 | Validation métier ; détail par champ dans `errors[]` |
| `request.timeout` | 504 | Traitement plus long que `HTTP_REQUEST_TIMEOUT` |
| `auth.unauthorized` | 401 | Token absent, invalide, expiré, ou session révoquée |
| `auth.forbidden` | 403 | Rôle insuffisant (ou admin sans 2FA) |
| `auth.invalid_credentials` | 401 | Email ou mot de passe incorrect — message générique, quel que soit le cas |
| `auth.email_taken` | 409 | Un compte existe déjà avec cet email |
| `auth.invalid_code` | 400 | Code à 6 chiffres faux, expiré ou épuisé — générique, email inconnu compris |
| `auth.invalid_refresh_token` | 401 | Refresh token inconnu, expiré ou réutilisé (session alors révoquée) |
| `auth.invalid_mfa_token` | 401 | Défi 2FA expiré ou épuisé : recommencer le login admin |
| `auth.invalid_second_factor` | 401 | Code TOTP ou code de secours incorrect |
| `auth.email_not_verified` | 403 | Fonction réservée aux emails vérifiés (signaler, favoris, notifications) |
| `auth.csrf_failed` | 403 | Jeton CSRF absent ou invalide (admin web) |
| `station.not_approved` | 403 | Station du gérant non approuvée ; extension `stationStatus` |
| `upload.unsupported_type` | 415 | Justificatif ni PDF, ni JPEG, ni PNG (type réel) |
| `upload.too_large` | 413 | Justificatif de plus de 5 Mo |
| `upload.invalid_file` | 422 | Fichier vide ou image corrompue |
| `route.not_found` | 404 | Route inconnue |
| `method.not_allowed` | 405 | Méthode non supportée sur cette route |
| `resource.not_found` | 404 | Ressource inexistante |
| `resource.conflict` | 409 | Conflit (unicité, état incompatible) |
| `rate_limit.exceeded` | 429 | Quota dépassé (voir `Retry-After`) |
| `service.unavailable` | 503 | Dépendance indisponible ou arrêt en cours (`/readyz`) |
| `internal.error` | 500 | Erreur interne : le détail n'est jamais exposé, il est journalisé avec le `requestId` |

Les codes métier s'ajoutent dans les domaines au fil des étapes ; on ne renomme jamais un code existant.

En-têtes sur toutes les réponses : `X-Request-ID` (repris du client s'il est valide, sinon un UUIDv7 généré), `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, et `Retry-After` sur les 429.

### Santé, clés et catalogue (publics)
| Méthode | Route | Description |
|---|---|---|
| GET | `/healthz` | ✅ Le processus répond (hors `/api/v1`) |
| GET | `/readyz` | ✅ PostgreSQL, Redis et OSRM répondent ; 503 pendant l'arrêt (hors `/api/v1`) |
| GET | `/.well-known/jwks.json` | ✅ Clés publiques Ed25519 de vérification des access tokens |
| GET | `/products` | ✅ Catalogue actif |

### Authentification (publiques)
| Méthode | Route | Description |
|---|---|---|
| POST | `/auth/register` | ✅ Inscription `user` ; envoie le code de vérification et ouvre une session (10/h par IP) |
| POST | `/auth/register/manager` | ✅ Inscription gérant + station `pending` (multipart : champs + justificatif ≤ 5 Mo) |
| POST | `/auth/verify-email` | ✅ `{ email, code }` : 15 min, 5 essais ; réponse générique |
| POST | `/auth/resend-verification` | ✅ `{ email }` : 1/min et 5/h par compte ; 202 générique |
| POST | `/auth/login` | ✅ Utilisateur ou gérant → access + refresh dans le corps (5/min par IP et par email) |
| POST | `/auth/refresh` | ✅ Rotation : corps (mobile) ou cookie + CSRF (admin web) ; réutilisation → session révoquée |
| POST | `/auth/logout` | ✅ Révoque la session courante (access, ou refresh dans le corps ou le cookie) ; 204 idempotent |
| POST | `/auth/password/forgot` | ✅ `{ email }` : code de réinitialisation ; 202 générique |
| POST | `/auth/password/reset` | ✅ `{ email, code, newPassword }` ; révoque toutes les sessions |
| POST | `/auth/admin/login` | ✅ Étape 1 admin : mot de passe → défi 2FA (`setup_required` avec secret TOTP, ou `required`) |
| POST | `/auth/admin/2fa` | ✅ Étape 2 admin : code TOTP ou code de secours → cookies de session (+ 10 codes de secours à la mise en place) |

### Compte 🔒 (tous rôles, gérant non approuvé compris)
| Méthode | Route | Description |
|---|---|---|
| GET | `/me` | ✅ Profil, `emailVerified`, `privacyPolicy.reacceptRequired`, station (gérant : statut et motif) |
| PATCH | `/me` | ✅ Prénom, nom |
| DELETE | `/me` | ✅ `{ password }` : anonymisation, révocation de toutes les sessions ; station du gérant suspendue (RGPD complet : étape 9) |
| POST | `/me/change-password` | ✅ `{ currentPassword, newPassword }` ; révoque les autres sessions, email de notification |
| POST | `/me/accept-privacy-policy` | ✅ `{ version }` : accepte la version courante |
| GET | `/me/sessions` | ✅ Sessions actives (client, user agent, dates, `current`) |
| DELETE | `/me/sessions/{id}` | ✅ Révoque une de ses sessions (404 pour celle d'un autre compte) |
| POST | `/auth/logout-all` | ✅ Révoque toutes ses sessions |
| POST / GET | `/me/data-requests` | Exercice des droits : accès, export, rectification, opposition ; suivi |
| POST | `/me/devices` | Enregistre le token push Expo — 🔒 **email vérifié** |
| DELETE | `/me/devices/{token}` | Désenregistre l'appareil |

### Recherche et itinéraire : publics, sans compte (rate limit par IP)
| Méthode | Route | Description |
|---|---|---|
| GET | `/search?productId&lat&lng` | Recherche (§4) |
| GET | `/stations/{id}` | Fiche publique d'une station `approved` : infos, horaires, stocks > 0 avec leur âge et le flag `stale` |
| GET | `/routes?fromLat&fromLng&stationId` | Itinéraire OSRM proxifié (`polyline6`, étapes, durée) ; origine jamais journalisée |

### Fonctions réservées aux comptes vérifiés 🔒 (`RequireVerifiedEmail`)
| Méthode | Route | Description |
|---|---|---|
| POST | `/stations/{id}/reports` | Signalement (limité à 3 par jour, par utilisateur et par station) |
| GET | `/me/favorites` | Mes stations favorites |
| PUT / DELETE | `/me/favorites/{stationId}` | Ajouter / retirer un favori (idempotent) |

### Gérant 🔒 `manager` + `RequireApprovedStation`
Tant que la station n'est pas approuvée, le gérant n'a accès qu'à son compte (`/me` montre le statut et le motif d'un rejet) : toute route gérant répond 403 `station.not_approved`.

| Méthode | Route | Description |
|---|---|---|
| GET | `/manager/station` | ✅ Station du gérant |
| PATCH | `/manager/station` | Nom, adresse, téléphone, marque. Une modification de l'IFU ou du RCCM renvoie la station en `pending`. |
| PUT | `/manager/station/document` | Renvoi du justificatif après un rejet (exception à `RequireApprovedStation`, réservée au statut `rejected`) |
| PUT | `/manager/station/location` | Épinglage `{ lat, lng, confirmStationLocation: true }` : l'avertissement UI doit être acquitté. Recalcule `h3_r8` et invalide le cache. |
| GET / PUT | `/manager/station/opening-hours` | Lecture / remplacement de la semaine complète |
| GET | `/manager/station/stocks` | Stocks courants |
| PUT | `/manager/station/stocks` | Mise à jour groupée `[{ productId, quantity }]`. Idempotente, écrit `stock_history`, met à jour `last_stock_update_at`, incrémente la génération. |
| GET | `/manager/station/stocks/history?productId&from&to` | Historique |

### Admin 🔒 `admin` (chaque mutation écrit dans `audit_logs`)
| Méthode | Route | Description |
|---|---|---|
| GET | `/admin/stations?status&q&cursor` | Stations et demandes de gérants (par défaut `pending`) ; un dossier n'apparaît qu'une fois l'email du gérant vérifié (D5) |
| GET | `/admin/stations/{id}` | Détail, historique de statut, signalements |
| GET | `/admin/stations/{id}/document` | ✅ Justificatif déchiffré (téléchargement forcé, `Cache-Control: no-store`, CSP `sandbox`, audité) |
| POST | `/admin/stations/{id}/approve` · `/reject` · `/suspend` · `/reinstate` | Transitions de statut (`{ reason }` obligatoire pour reject et suspend) ; push au gérant |
| GET | `/admin/map/stations?bbox&productId&status` | GeoJSON pour la carte (clustering côté client) |
| GET / POST | `/admin/products` | Catalogue |
| PATCH | `/admin/products/{id}` | Libellé, ordre, activation (pas de suppression) |
| GET | `/admin/shortage-zones?productId&from&to` | Cellules H3 res 7 en GeoJSON : demande et absence de stock (k ≥ 5) |
| GET | `/admin/stale-stocks?olderThan=24h` | Stocks expirés (> 24 h, donc exclus de la recherche) ; `olderThan=8h` liste aussi les stocks `stale` |
| GET | `/admin/reports?status&cursor` | Signalements |
| PATCH | `/admin/reports/{id}` | Résoudre ou classer |
| GET | `/admin/stats/overview` · `/admin/stats/searches?productId&granularity` | Indicateurs (stations, stocks, recherches agrégées) |
| GET | `/admin/audit-logs?actorId&entityType&from&to&cursor` | Journal d'audit |
| GET | `/admin/data-requests?status` | Demandes APDP |
| PATCH | `/admin/data-requests/{id}` | Traitement (statut, note, génération d'export) |
| GET | `/admin/users?role&q&cursor` | Comptes |
| PATCH | `/admin/users/{id}` | Désactivation / réactivation (révoque les sessions) |

Les comptes admin se créent uniquement via la CLI `cmd/admin` (`make admin-create`) : aucune route publique. Toutes les routes admin exigent une session ouverte après 2FA (claim `mfa`).

## 6. Authentification et sécurité

### 6.1 Flux utilisateur et gérant (mobile)

```mermaid
sequenceDiagram
  autonumber
  participant M as App mobile
  participant A as API
  participant R as Redis
  participant P as PostgreSQL
  participant S as SMTP (Mailpit en dev)
  M->>A: POST /auth/register (ou /register/manager, multipart)
  A->>P: INSERT user (argon2id) [+ station pending + justificatif chiffré]
  A->>R: code 6 chiffres (HMAC, 15 min, 5 essais) + délai de renvoi 1 min
  A-->>S: email « Confirmez votre adresse » (asynchrone)
  A->>R: session sid + refresh token (SHA-256)
  A-->>M: 201 accessToken (EdDSA, 15 min) + refreshToken + profil
  M->>A: POST /auth/verify-email { email, code }
  A->>R: vérification atomique (Lua) puis destruction du code
  A->>P: email_verified_at = now()
  A-->>M: 204
  Note over M,A: 15 min plus tard
  M->>A: POST /auth/refresh { refreshToken }
  A->>R: rotation atomique : ancien → « used », nouveau courant
  A-->>M: 200 nouvelle paire
  M->>A: POST /auth/refresh { ancien refreshToken }
  A->>R: « used » détecté → révocation de toute la session
  A-->>M: 401 auth.invalid_refresh_token (audit : refresh_reuse_detected)
```

### 6.2 Flux admin (web, 2FA obligatoire)

```mermaid
sequenceDiagram
  autonumber
  participant W as Admin web
  participant A as API
  participant R as Redis
  participant P as PostgreSQL
  W->>A: POST /auth/admin/login { email, password }
  A->>P: vérification (temps constant, réponse générique)
  alt 2FA pas encore configurée
    A->>R: défi mfaToken (5 min, 5 essais) + secret TOTP en attente (chiffré)
    A-->>W: 200 { mfaToken, twoFactor: setup_required, setup: { secret, otpauthUri } }
  else 2FA configurée
    A->>R: défi mfaToken
    A-->>W: 200 { mfaToken, twoFactor: required }
  end
  W->>A: POST /auth/admin/2fa { mfaToken, code | recoveryCode }
  A->>R: anti-rejeu : pas TOTP > dernier pas accepté
  A->>P: (mise en place) secret chiffré + 10 codes de secours hachés
  A->>R: session admin (mfa = true, 12 h glissantes)
  A-->>W: 200 { user, csrfToken, recoveryCodes? } + Set-Cookie __Host-gs_at, __Secure-gs_rt, gs_csrf
  W->>A: POST /me/... (cookie + X-CSRF-Token)
  A->>R: session encore active ?
  A-->>W: 200
```

### 6.3 Mécanismes

- **Mots de passe** : argon2id aux paramètres **OWASP** (m = 19 MiB, t = 2, p = 1, sel de 16 o, clé de 32 o), format PHC. Re-hash automatique au login si les paramètres changent. Un sémaphore borne les calculs simultanés.
  Politique : 8 à 128 caractères, refus des mots de passe courants (liste embarquée de plus de 2 000 entrées, dont des mots de passe courants en français et au Bénin), refus de l'email ou de « gostation » dans le mot de passe.
- **Access token** : JWT **EdDSA (Ed25519)** de 15 min. En-tête `kid` ; claims `sub`, `role`, `sid` (session), `mfa` (admin), `iss`, `aud`, `iat`, `nbf`, `exp`, `jti`. Seul l'algorithme EdDSA est accepté (pas de confusion d'algorithme).
  Rotation des clés : `JWT_SIGNING_KEYS=nouvelle,ancienne`. La première clé signe, toutes vérifient. On retire l'ancienne après 15 min. Les clés publiques sont sur `/.well-known/jwks.json`.
- **Sessions et refresh tokens** (Redis) :
  - `auth:sess:{sid}` (HASH : uid, rôle, client, user agent tronqué, mfa, dates, hash du token courant) ;
  - `auth:rt:{sha256(token)}` → sid, puis `used:{sid}` après rotation ;
  - `auth:user:{uid}:sess` (SET des sids).

  Le token est opaque (256 bits, préfixe `gsr_`), stocké uniquement haché, renouvelé à chaque usage par un script Lua atomique. **Présenter un token déjà consommé révoque toute la session.** Durée : 30 j glissants (utilisateurs), 12 h (admins).
  Chaque requête authentifiée vérifie que la session existe encore : logout, changement de mot de passe et révocation prennent effet immédiatement, sans attendre l'expiration de l'access token. Les clients doivent sérialiser leurs appels à `/auth/refresh`.
- **Stockage côté client** :
  - mobile : access et refresh tokens dans `expo-secure-store`, refresh transmis dans le corps des requêtes ;
  - admin web : cookies posés par l'API. `__Host-gs_at` (access, `Path=/`) et `__Secure-gs_rt` (refresh, `Path=/api/v1/auth`) sont `HttpOnly; Secure; SameSite=Strict`. `gs_csrf` reste lisible par le JavaScript.
- **CSRF** (admin web) : le jeton vaut `HMAC(clé CSRF, sid)`, lié à la session. Il est exigé dans `X-CSRF-Token` sur toute requête non GET authentifiée par cookie, refresh et logout compris. `SameSite=Strict` complète la protection.
- **Codes à 6 chiffres** (vérification de l'email, réinitialisation) : `otp:{usage}:{uid}` dans Redis.
  - Le code est stocké sous forme de HMAC-SHA256 (clé dérivée d'`APP_SECRET`), valable 15 min, avec 5 essais (détruit au 5e échec, vérification atomique en Lua).
  - Renvoi : 1 par minute (`SET NX`) et 5 par heure (fenêtre glissante).
  - Un compte non vérifié se connecte, mais `RequireVerifiedEmail` (état lu en base) bloque signalements, favoris et notifications.
- **2FA admin** : TOTP RFC 6238 (HMAC-SHA1, 6 chiffres, 30 s, ± 1 pas), compatible avec toutes les applis d'authentification.
  - Le secret est chiffré en AES-256-GCM, lié à l'id de l'admin.
  - Anti-rejeu : un pas déjà accepté est refusé.
  - 10 codes de secours de 80 bits, stockés en SHA-256, chacun utilisable une seule fois.
  - Réinitialisation : `make admin-reset-2fa`.
  - Aucune session admin sans 2FA, et `RequireRole(admin)` vérifie le claim `mfa`.
- **Anti-énumération** : `login`, `admin/login`, `verify-email`, `password/reset`, `resend-verification` et `password/forgot` répondent pareil que le compte existe ou non. Le mot de passe d'un compte inexistant est quand même vérifié contre un hash factice (temps constant), et les emails partent en asynchrone (aucune différence de temps de réponse).
- **Autorisation** : `Authenticate` (Bearer ou cookie) → `RequireRole` → `RequireVerifiedEmail` / `RequireApprovedStation`. Ces deux derniers lisent l'état en base à chaque requête : une suspension ou une vérification prend effet immédiatement.
- **Rate limiting** (Redis, fenêtre glissante, sans arrondi : pas de requête de trop au changement de fenêtre) :

  | Action | Limite |
  |---|---|
  | Global `/api/v1` | 300/min par IP (`RATE_LIMIT_IP_REQUESTS` / `RATE_LIMIT_IP_WINDOW`) |
  | Login (`/auth/login`, `/auth/admin/login`) | 5/min par IP **et** 5/min par email (empreinte HMAC) |
  | Inscription (utilisateur et gérant) | 10/h par IP |
  | Vérification de codes (email, reset, 2FA) | 30 / 10 min par IP, et 5 essais par code ou défi |
  | Envoi d'emails (resend, forgot) | 20/h par IP, et 1/min puis 5/h par compte |
  | Recherche (publique) | 60/min par IP (étape 4) |
  | `/routes` | 30/min (étape 4) |
  | Signalements | 3/jour par station |

  Les IP ne sont jamais écrites en clair dans Redis (empreinte SHA-256). Redis indisponible → la requête passe (fail open), mais l'authentification, elle, échoue (sessions indisponibles).
- **Justificatifs IFU** :
  - type contrôlé par les magic bytes : PDF, JPEG ou PNG, 5 Mo max, lecture en flux (jamais de fichier temporaire en clair) ;
  - images débarrassées de leurs métadonnées sans recompression : segments EXIF, XMP, IPTC et COM pour le JPEG, chunks `eXIf`, `tEXt`, `zTXt`, `iTXt` et `tIME` pour le PNG ;
  - chiffrement par enveloppe : une DEK AES-256-GCM par fichier, chiffrée par la KEK `DOCUMENTS_ENCRYPTION_KEY` (versionnée pour la rotation, KMS en prod), avec la clé de stockage comme AAD ;
  - empreinte SHA-256 vérifiée à la lecture ;
  - interface `Storage` : disque local (0600), S3 compatible au déploiement ;
  - lecture réservée aux admins, auditée.
- **Secrets dérivés** : `APP_SECRET` → sous-clés HKDF-SHA256 distinctes (`otp-hmac`, `csrf`, `email-fingerprint`, `totp-encryption`).
- **Audit** (`audit_logs`, en ajout seul) :
  - connexions et échecs, avec motif et empreinte HMAC de l'email, jamais l'email en clair ;
  - 2FA (activation, échecs, codes de secours) ;
  - réutilisation de refresh token ;
  - logout, logout-all, révocation de session ;
  - changement et réinitialisation de mot de passe ;
  - suppression de compte ;
  - actions admin : création et reset 2FA par la CLI, lecture de justificatif.
- **Divers** : CORS limité à `CORS_ALLOWED_ORIGINS`, avec credentials. Corps bornés (1 Mo en JSON, 5 Mo + 256 Ko pour l'inscription gérant). `Cache-Control: no-store` sur les réponses contenant des tokens.

## 7. Jobs asynchrones (asynq)

| Tâche | Déclenchement | Rôle |
|---|---|---|
| `stock:reminders:scan` | Toutes les 15 min | Stations `approved` **ouvertes maintenant** (fuseau `Africa/Porto-Novo`) avec `last_stock_update_at` et `last_reminder_at` plus vieux que 4 h → `push:send` au gérant |
| `push:send` | À la demande | Envoi par lots de 100 vers l'Expo Push API, puis lecture des reçus : `DeviceNotRegistered` supprime le token |
| `stats:flush` | Toutes les 5 min | Compteurs Redis → `search_stats` (upsert) |
| `retention:purge` | Chaque jour à 03:00 | Purges selon §8 |
| `data-requests:export` | À la demande | Archive JSON des données d'un utilisateur, chiffrée, lien valable 7 j |

Les tâches sont idempotentes (clé d'unicité asynq), avec retry et backoff exponentiel, et une file `critical` séparée pour les push.

En attendant asynq, les **emails transactionnels** partent via une file en mémoire (`mail.Async` : 2 workers, file bornée, vidée à l'arrêt propre). Ils basculeront sur une tâche `email:send` pour survivre aux redémarrages.

## 8. Données personnelles et conservation

| Donnée | Base légale / finalité | Conservation proposée* |
|---|---|---|
| Position de l'utilisateur | Exécution du service (recherche, itinéraire) | **Aucune** : traitée en mémoire, jamais journalisée |
| Stats de recherche (H3 res 7, par heure) | Intérêt légitime (pénuries) | 24 mois, déjà anonymes |
| Compte utilisateur | Contrat | Durée du compte ; purge 30 j après la demande de suppression |
| Comptes inactifs | Minimisation | Relance à 24 mois, suppression à 36 mois |
| Justificatif IFU d'une station approuvée | Obligation de vérification | Tant que la station est active + 12 mois |
| Justificatif d'une demande rejetée | Idem | 90 j après le rejet |
| Refresh tokens et sessions | Sécurité | 30 j glissants (12 h pour les admins), TTL Redis ; supprimés au logout et à la révocation |
| Codes à 6 chiffres, défis 2FA | Sécurité | 15 min / 5 min (TTL Redis), détruits après usage ou 5 échecs |
| Codes de secours 2FA | Sécurité | Jusqu'à usage, remplacement ou reset ; supprimés avec le compte |
| Tokens push | Exécution du service | Jusqu'à la déconnexion, ou 90 j sans activité |
| Historique des stocks | Intérêt légitime (fiabilité, stats) | 24 mois, puis agrégé |
| Signalements | Modération | 12 mois après résolution ; `reporter_id` mis à NULL à la suppression du compte |
| Journal d'audit | Sécurité, responsabilité | 12 mois |
| Demandes d'exercice des droits | Preuve de conformité | 3 ans après clôture |
| Logs applicatifs (sans position ni token) | Sécurité | 30 j |

\* Durées à valider avec un juriste ou DPO au regard du Code du numérique (Livre V) et des délibérations de l'APDP.

## 9. Décisions et questions ouvertes

### Décisions (2026-10-10)

| # | Sujet | Décision |
|---|---|---|
| D1 | Stations fermées | **Masquées** de la recherche. Si aucune station ouverte n'est trouvée à 50 km, on renvoie les plus proches fermées avec leur heure de réouverture (§4, étape 3). |
| D2 | Données périmées | Stock non mis à jour depuis **plus de 8 h** : flag `stale` (badge UI). **Plus de 24 h** : exclu de la recherche et listé côté admin. |
| D3 | Recherche sans compte | **Autorisée** (recherche, fiche station, itinéraire), avec un rate limit par IP dans Redis. Un compte est requis pour signaler, gérer ses favoris et recevoir des notifications. |
| D4 | Hébergement | Reporté à l'**étape déploiement** : localisation des données (APDP) et stockage objet des justificatifs. |
| D5 | Vérification de l'email | **Obligatoire**, par code à 6 chiffres (pas de lien). Valable 15 min, 5 essais, stocké haché (HMAC) dans Redis. Renvoi limité à 1/min et 5/h. Un compte non vérifié peut se connecter, mais pas signaler, ajouter des favoris ni activer les notifications. Le dossier d'un gérant n'apparaît chez l'admin qu'une fois son email vérifié. |
| D6 | OTP SMS des gérants | **Pas en V1**. Le téléphone est collecté et vérifié manuellement par l'admin. |
| D7 | 2FA admin | **Obligatoire dès la V1** : TOTP (RFC 6238) et 10 codes de secours hachés. Aucune session admin n'est créée sans 2FA. |
| D8 | Emails | Interface `Mailer` + implémentation SMTP générique, envoi asynchrone (pas de fuite par le temps de réponse). En dev, Mailpit (profil compose `dev`). Templates HTML + texte en français, aux couleurs de GoStation. |
| D9 | Politique de confidentialité | Version courante `1.0`. Version et date d'acceptation enregistrées à l'inscription. Si la version change, `GET /me` renvoie `reacceptRequired: true` jusqu'à `POST /me/accept-privacy-policy`. |
| D10 | Justificatifs IFU | PDF, JPG ou PNG, 5 Mo max, type vérifié par les magic bytes (jamais l'extension), métadonnées EXIF/XMP/IPTC retirées des images. Chiffrement AES-256-GCM avec une clé par fichier, elle-même chiffrée par `DOCUMENTS_ENCRYPTION_KEY` (envelope encryption). Stockage derrière l'interface `Storage` (disque local, S3 compatible plus tard). Jamais servis publiquement : lecture réservée aux admins, auditée. |

### Questions ouvertes

1. **Réseaux de stations** : un gérant peut-il gérer plusieurs stations, et plusieurs stations peuvent-elles partager un même IFU ? (Le modèle actuel suppose un gérant = une station et ne rend pas l'IFU unique.)
2. **Délais légaux** : délai de réponse aux demandes APDP et durées de conservation (§8), à confirmer.
3. **Prix** des carburants et du gaz : hors périmètre V1 ?
