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
    SMTP["SMTP<br/>(Mailpit en dev)"]
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
  WRK -- "push · reçus" --> EXPO
  WRK -- "emails" --> SMTP
  EXPO -. "notifications" .-> MOB
```

Principes :
- **Un seul module Go, deux processus** (`cmd/api`, `cmd/worker`) qui partagent `internal/` et la même image Docker. L'API est sans état : on la scale horizontalement. Elle ne fait que **mettre en file** (asynq dans Redis) les emails, les push et les alertes ; le worker les exécute, avec retry et backoff.
- **Le worker tourne en une seule instance** tant que son scheduler (tâches périodiques) n'est pas séparé (§7, D25).
- **OSRM n'est jamais exposé publiquement** : l'API le proxifie (`/routes`), ce qui permet le rate limiting et garantit qu'aucune position n'est journalisée.
- **Les tuiles OpenFreeMap sont chargées directement par les clients** (pas de proxy).
- **Le stockage des justificatifs** est un système de fichiers local en dev et un stockage objet compatible S3 en prod (§9, Q5).

## 2. Composants

| Composant | Rôle | Techno |
|---|---|---|
| API | Auth, recherche, gestion des stations et des stocks, back-office admin | Go, chi, pgx v5 + sqlc, go-redis v9, golang-jwt v5, h3-go v4, slog |
| Worker | Emails, push Expo (lots, reçus), alertes « de retour en stock », rappels de stock, vidage des stats (et de leurs agrégats), relevé horaire de la fraîcheur des stocks, exports admin, purges de conservation (exports RGPD à l'étape 9) ; scheduler intégré, une seule instance | asynq v0.26 (Redis), supervision asynqmon en dev |
| PostgreSQL + PostGIS | Source de vérité ; requêtes spatiales (`ST_DWithin`, KNN `<->`) | PG 18, PostGIS 3.6, migrations goose |
| Redis | Cache de recherche (H3 + produit), refresh tokens, files asynq, rate limiting, compteurs de stats | Redis 8.10, `noeviction` |
| OSRM | Matrice de temps de trajet (`/table`) et itinéraire (`/route`) | osrm-backend v26.10, MLD |
| Mobile | Recherche, carte, itinéraire, compte, favoris, signalements, notifications (user) ; station, horaires, stocks (manager, 9B) | Expo SDK 57 (dev build), Expo Router, NativeWind, Reanimated 4, MapLibre RN v11, FlashList 2, TanStack Query (persisté dans MMKV), Zustand, openapi-fetch, zod/mini (D49 à D55) |
| Web admin | Validation, catalogue, carte, pénuries, signalements, stats, audit, demandes APDP | Vite 8, React 19 (React Compiler), Tailwind 4, shadcn/ui + 21st.dev, TanStack Router/Query/Table, openapi-fetch, zod/mini, Recharts (shadcn Chart), maplibre-gl, pdf.js, dnd-kit (D41 à D48) |

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
  stations ||--o{ station_closures : "fermetures"
  stations ||--o{ station_location_requests : "déplacements"
  stations ||--o{ station_stocks : "stocke"
  stations ||--o{ stock_history : "historise"
  stations ||--o{ reports : "concerne"
  products ||--o{ station_stocks : "référence"
  products ||--o{ stock_history : "référence"
  products ||--o{ search_stats : "agrège"
  users ||--o{ notifications : "reçoit"
  users ||--o{ notification_opt_outs : "désactive"
  users ||--o{ back_in_stock_alerts : "est alerté"
  favorites ||--o{ favorite_alerts : "suit un produit"
  stations ||--o| station_reminders : "rappels du jour"
  stations ||--o{ station_report_flags : "effets des signalements"
  stations ||--o{ admin_alerts : "alerte l'admin"
  users ||--o{ exports : "demande"
  products ||--o{ search_stats_daily : "agrège par jour"
  products ||--o{ search_stats_totals : "agrège tous lieux"
  products ||--o{ stock_freshness_stats : "relève"

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
    text session_id
    uuid install_id UK
  }
  notifications {
    uuid id PK
    uuid user_id FK
    notification_type type
    jsonb data
    timestamptz read_at
  }
  notification_opt_outs {
    uuid user_id PK
    notification_type type PK
  }
  station_reminders {
    uuid station_id PK
    date day
    smallint sent
    smallint streak
    timestamptz muted_until
  }
  station_report_flags {
    uuid id PK
    uuid station_id FK
    report_reason reason
    smallint product_id FK
    timestamptz excluded_at
  }
  admin_alerts {
    uuid id PK
    admin_alert_kind kind
    uuid station_id FK
    timestamptz resolved_at
  }
  favorite_alerts {
    uuid user_id PK
    uuid station_id PK
    smallint product_id PK
  }
  back_in_stock_alerts {
    uuid id PK
    uuid user_id FK
    back_in_stock_status status
    timestamptz sent_at
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
  station_closures {
    uuid id PK
    uuid station_id FK
    date closed_on
    text reason
  }
  station_location_requests {
    uuid id PK
    uuid station_id FK
    geography location
    int distance_m
    location_request_status status
  }
  country_boundaries {
    char code PK
    geography boundary
    geography boundary_buffered
  }
  exports {
    uuid id PK
    uuid requested_by FK
    export_dataset dataset
    export_status status
    timestamptz expires_at
  }
  search_stats_daily {
    date day PK
    bigint h3_r7 PK
    smallint product_id PK
    int searches
  }
  search_stats_totals {
    timestamptz bucket PK
    smallint product_id PK
    int searches
  }
  stock_freshness_stats {
    timestamptz bucket PK
    smallint product_id PK
    int fresh
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
CREATE TYPE report_reason       AS ENUM ('out_of_stock', 'station_closed', 'wrong_location', 'other');  -- out_of_stock : ex-stock_incorrect (étape 6)
CREATE TYPE report_status       AS ENUM ('open', 'resolved', 'dismissed');
CREATE TYPE data_request_type   AS ENUM ('access', 'export', 'rectification', 'deletion', 'opposition');
CREATE TYPE data_request_status AS ENUM ('pending', 'in_progress', 'completed', 'rejected');
CREATE TYPE device_platform     AS ENUM ('ios', 'android');
-- Étape 6
CREATE TYPE notification_type    AS ENUM ('stock_reminder', 'station_reported', 'back_in_stock');
CREATE TYPE admin_alert_kind     AS ENUM ('manager_inactive', 'reports_threshold');
CREATE TYPE back_in_stock_status AS ENUM ('pending', 'sent', 'dropped');
-- Étape 7
CREATE TYPE export_dataset AS ENUM ('stations', 'stocks', 'search_stats', 'reports', 'audit');
CREATE TYPE export_format  AS ENUM ('csv', 'json');
CREATE TYPE export_status  AS ENUM ('pending', 'ready', 'failed', 'expired');
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

-- Stations et stocks côté gérant (étape 4).
ALTER TABLE stations
  ADD COLUMN version                   integer NOT NULL DEFAULT 1,  -- verrouillage optimiste (ETag)
  ADD COLUMN location_flagged_at       timestamptz,  -- épingle à plus de 500 m de l'appareil
  ADD COLUMN location_flag_distance_m  integer,
  ADD COLUMN location_flag_accuracy_m  integer;

-- updated_at ne bouge que si la quantité change (trigger dédié set_stock_updated_at) ;
-- last_confirmed_at enregistre « rien n'a changé ». Fraîcheur = GREATEST(updated_at, last_confirmed_at).
ALTER TABLE station_stocks ADD COLUMN last_confirmed_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX idx_station_stocks_freshness ON station_stocks (GREATEST(updated_at, last_confirmed_at));
-- (remplace idx_station_stocks_updated_at)

-- Fermetures exceptionnelles (jours fériés compris) : journée civile entière, heure du Bénin.
CREATE TABLE station_closures (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  station_id  uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  closed_on   date NOT NULL,
  reason      text CHECK (char_length(reason) <= 200),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_station_closures_day UNIQUE (station_id, closed_on)
);

-- Demandes de déplacement (≥ 200 m) : l'ancienne position reste active jusqu'à validation.
CREATE TYPE location_request_status AS ENUM ('pending', 'approved', 'rejected', 'superseded');
CREATE TABLE station_location_requests (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  station_id         uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  requested_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  location           geography(Point, 4326) NOT NULL,  -- + lat/lng générées
  h3_r8              bigint NOT NULL,
  distance_m         integer NOT NULL,      -- depuis la position active
  device_distance_m  integer,               -- seule trace de la position de l'appareil
  device_accuracy_m  integer,
  status             location_request_status NOT NULL DEFAULT 'pending',
  review_reason      text,
  reviewed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_station_location_requests_pending ON station_location_requests (station_id)
  WHERE status = 'pending';   -- une nouvelle demande remplace la précédente (superseded)

-- Frontières (contrôle des épingles) : Natural Earth 1:10m, domaine public, migration de données.
CREATE TABLE country_boundaries (
  code               char(3) PRIMARY KEY,               -- 'BEN'
  name               text NOT NULL,
  boundary           geography(MultiPolygon, 4326) NOT NULL,
  boundary_buffered  geography NOT NULL,                -- ST_Buffer(boundary, 2000) : marge de 2 km
  source             text NOT NULL
);

-- Ajout (décision §9) : favoris, réservés aux utilisateurs connectés. Supprimés avec le compte.
CREATE TABLE favorites (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id  uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, station_id)
);
CREATE INDEX idx_favorites_station ON favorites (station_id);

-- Notifications (étape 6). Un appareil = une installation, lié à la session qui l'a enregistré :
-- logout, révocation, changement ou réinitialisation du mot de passe suppriment son token.
ALTER TABLE device_tokens
  ADD COLUMN session_id  text NOT NULL,
  ADD COLUMN install_id  uuid NOT NULL UNIQUE,
  ADD COLUMN language    text NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'en'));  -- langue des push

CREATE TABLE notifications (               -- boîte de réception, purgée à 30 jours
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',   -- paramètres d'affichage : jamais de position ni d'identité d'un tiers
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz,
  pushed_at   timestamptz                    -- push remis à Expo (idempotence des retries)
);
CREATE TABLE notification_opt_outs (       -- préférences : une ligne = type désactivé
  user_id uuid REFERENCES users(id) ON DELETE CASCADE, type notification_type,
  PRIMARY KEY (user_id, type)
);

-- Rappels de stock : état du jour par station, à part pour que le worker n'écrive jamais dans
-- stations (verrouillage optimiste). Remplace stations.last_reminder_at, supprimée.
CREATE TABLE station_reminders (
  station_id    uuid PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
  day           date NOT NULL,              -- journée locale des compteurs
  sent          smallint NOT NULL DEFAULT 0,  -- rappels du jour (plafond 4)
  streak        smallint NOT NULL DEFAULT 0,  -- rappels depuis la dernière mise à jour (escalade à 3)
  stopped       boolean NOT NULL DEFAULT false,
  last_sent_at  timestamptz,
  muted_until   timestamptz
);

-- Signalements (étape 6) : commentaire ≤ 300 caractères, obligatoire pour « other » ; produit
-- obligatoire pour out_of_stock et interdit sinon ; classement abusif ; retrait du droit de signaler.
ALTER TABLE reports ADD COLUMN abusive boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN reporting_banned_at timestamptz, ADD COLUMN reporting_ban_reason text;

-- Effet en cours d'une cause (station + motif + produit) : 3 auteurs = badge, 5 = exclusion.
-- Supprimé à la prochaine mise à jour ou confirmation du gérant.
CREATE TABLE station_report_flags (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  station_id   uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  reason       report_reason NOT NULL,
  product_id   smallint REFERENCES products(id),   -- NULL : toute la station
  reporters    smallint NOT NULL,
  flagged_at   timestamptz NOT NULL DEFAULT now(),
  excluded_at  timestamptz,
  CONSTRAINT uq_station_report_flags UNIQUE NULLS NOT DISTINCT (station_id, reason, product_id)
);

CREATE TABLE admin_alerts (                -- gérant inactif, seuil de 5 signalements
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  kind         admin_alert_kind NOT NULL,
  station_id   uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  reason       report_reason, product_id smallint REFERENCES products(id),
  details      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES users(id) ON DELETE SET NULL,  -- NULL + resolved_at : résolue par le gérant
  resolution   text
);
CREATE UNIQUE INDEX uq_admin_alerts_open ON admin_alerts (kind, station_id, reason, product_id)
  NULLS NOT DISTINCT WHERE resolved_at IS NULL;   -- une seule alerte ouverte par cause

-- Favoris : alerte « de retour en stock » par produit, et journal des alertes (limites, nuit).
CREATE TABLE favorite_alerts (
  user_id uuid, station_id uuid, product_id smallint REFERENCES products(id),
  PRIMARY KEY (user_id, station_id, product_id),
  FOREIGN KEY (user_id, station_id) REFERENCES favorites (user_id, station_id) ON DELETE CASCADE
);
CREATE TABLE back_in_stock_alerts (        -- purgé à 30 jours
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id  uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  product_id  smallint NOT NULL REFERENCES products(id),
  status      back_in_stock_status NOT NULL,   -- pending : heures calmes, part à 7 h
  created_at  timestamptz NOT NULL,
  sent_at     timestamptz
);
CREATE UNIQUE INDEX uq_back_in_stock_alerts_pending ON back_in_stock_alerts (user_id, station_id, product_id)
  WHERE status = 'pending';

-- API admin (étape 7). Compte désactivé par l'admin : connexion refusée (auth.account_disabled).
ALTER TABLE users ADD COLUMN disabled_at timestamptz, ADD COLUMN disabled_reason text,
  ADD CONSTRAINT ck_users_disabled CHECK ((status = 'disabled') = (disabled_at IS NOT NULL));
CREATE INDEX idx_users_created ON users (created_at DESC, id DESC);

-- Dernier changement de statut (ancienneté des dossiers en attente), tenu par un trigger
-- set_status_changed_at() quel que soit le chemin d'écriture.
ALTER TABLE stations ADD COLUMN status_changed_at timestamptz NOT NULL DEFAULT now();

-- Agrégats des stats de recherche, alimentés par stats:flush dans la même transaction que
-- search_stats (upsert additif) : jamais de rafraîchissement complet à faire.
CREATE TABLE search_stats_daily (          -- jour local × cellule × produit : pénuries 7/30 j, export
  day date, h3_r7 bigint, product_id smallint REFERENCES products(id),
  searches integer NOT NULL, empty_within_5km integer NOT NULL,
  PRIMARY KEY (day, h3_r7, product_id)
);
CREATE TABLE search_stats_totals (         -- heure × produit, tous lieux : totaux, séries, heure de la journée
  bucket timestamptz, product_id smallint REFERENCES products(id),
  searches integer NOT NULL, empty_within_5km integer NOT NULL,
  PRIMARY KEY (bucket, product_id)
);

-- Relevé horaire de la fraîcheur des stocks (stations approuvées, produits actifs) : séries du
-- tableau de bord (la fraîcheur passée ne se reconstitue pas : les confirmations ne sont pas historisées).
CREATE TABLE stock_freshness_stats (
  bucket timestamptz, product_id smallint REFERENCES products(id),
  fresh integer NOT NULL, stale integer NOT NULL, expired integer NOT NULL,
  PRIMARY KEY (bucket, product_id)
);

-- Exports admin : générés par le worker, fichier chiffré (enveloppe, comme les justificatifs)
-- supprimé 24 h après sa génération ; la ligne reste (statut expired) pour l'historique.
CREATE TABLE exports (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  requested_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  dataset       export_dataset NOT NULL,
  format        export_format  NOT NULL,
  params        jsonb NOT NULL DEFAULT '{}',          -- période, produit
  status        export_status  NOT NULL DEFAULT 'pending',
  object_key    text, wrapped_key bytea, sha256 bytea, -- présents seulement si ready
  size_bytes    bigint, row_count integer,
  error         text,                                  -- code générique (too_many_rows…)
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  expires_at    timestamptz                            -- completed_at + 24 h
);

-- Journal d'audit : lecture admin par période et par action (curseur created_at, id).
CREATE INDEX idx_audit_logs_created ON audit_logs (created_at DESC, id DESC);
CREATE INDEX idx_audit_logs_action  ON audit_logs (action, created_at DESC);
```

**Colonnes `lat` / `lng` générées** : l'application ne lit jamais le type `geography`. Elle écrit `location` à partir de `lat`/`lng` (`ST_MakePoint(lng, lat)`) et lit les colonnes générées, que sqlc type correctement en `*float64` nullables. Une expression `ST_Y(...)` dans un SELECT serait typée non nullable par sqlc. `STORED` est imposé : PostgreSQL 18 interdit les fonctions d'extension dans une colonne virtuelle.

**Trigger `updated_at`** : une fonction `set_updated_at()` est appelée `BEFORE UPDATE` sur `users`, `stations`, `products` et `station_stocks`. Elle pose `now()`, sauf si la requête fixe elle-même `updated_at` (reprises de données, tests de péremption).

**Catalogue initial** (migration de données séparée) : gaz 5 kg, 10 kg et 25 kg (unité : bouteille), essence et gasoil (unité : litre). L'admin ajoute des produits et en modifie le libellé, l'ordre et l'activation ; type et taille sont figés, rien n'est supprimé (D37).

## 4. Algorithme de recherche

**Entrée** : `product_id`, `lat`, `lng` (position courante, jamais stockée ni journalisée). Endpoint **public**, connexion facultative. Quotas (D22) : 300/min par IP et 30/min par installation (`X-Install-Id`) ou par utilisateur connecté.
**Sortie** : jusqu'à 10 stations `approved`, avec horaires, produit vendu en `quantity > 0`, stock de moins de 24 h, **ouvertes maintenant** et non exclues par des signalements, classées par temps de trajet réel. S'il n'y a aucune station ouverte à 50 km : repli sur les ouvertes plus loin et les fermées, triées par heure à laquelle on peut être servi (D19).

**Fraîcheur du stock** (âge = `now() - GREATEST(updated_at, last_confirmed_at)` : une confirmation « rien n'a changé » compte comme une mise à jour) :

| Âge | Effet |
|---|---|
| ≤ 8 h (`STOCK_STALE_AFTER`) | Normal |
| 8 h à 24 h | `stale: true` : badge « à vérifier » côté UI |
| > 24 h (`STOCK_EXPIRED_AFTER`) | Exclu de la recherche, quantité masquée sur la fiche publique |

**Ouverture** : calculée à partir de `station_opening_hours` et `station_closures` dans le fuseau `APP_TIMEZONE` (`Africa/Porto-Novo`), par la même règle que `station.Schedule.IsOpen` (testée sur les cas limites). Les plages qui passent minuit (`closes_at <= opens_at`) et le 24 h/24 (`00:00 → 24:00`) sont gérés. Une fermeture exceptionnelle ferme la journée civile entière, y compris la fin, ce jour-là, d'une plage commencée la veille. Le jour ISO, l'heure locale, la date et la veille sont calculés en Go puis passés en paramètres SQL. Une station sans horaires ou sans position n'apparaît pas.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client mobile
  participant A as API
  participant R as Redis
  participant P as PostGIS
  participant O as OSRM
  C->>A: GET /api/v1/search?lat&lng&product_id (X-Install-Id)
  A->>R: quotas IP + installation/utilisateur
  A->>P: couverture (Bénin ? ≤ 30 km ?) · produit actif
  A->>A: cellule H3 res 8
  A->>R: GET search:v1:p{id}:g{all}.{gen}:c{cell}
  alt candidats en cache
    R-->>A: ensemble des candidats (sans position utilisateur)
  else
    loop rayons 500 m → 50 km depuis le centre de la cellule (+ marge)
      A->>P: ST_DWithin, ouvertes, en stock, fraîches (≤ 20)
    end
    opt aucune ouverte à 50 km
      A->>P: KNN ouvertes (≤ 10) + KNN en stock avec horaires (≤ 20)
      A->>A: prochaine ouverture des fermées
    end
    A->>R: SET … EX 60
  end
  A->>A: distance exacte (haversine), tri, 10 meilleurs
  A->>O: /table 1 → 10 depuis la position exacte (jamais en cache)
  O-->>A: durées et distances routières
  A->>R: HINCRBY stats (cellule res 7, produit, heure)
  A-->>C: 200 résultats (X-Cache, Server-Timing)
```

### 4.1 Étapes

1. **Validation et couverture (D20).** Coordonnées dans les bornes, produit actif. `CheckCoverage` : `ST_Covers(boundary_buffered, p)` → au Bénin (frontière élargie de 2 km), classement OSRM ; sinon `ST_DWithin(boundary, p, 30 km)` → classement à vol d'oiseau, `routingApproximate: true` ; sinon 422 `search.out_of_coverage`.
2. **Candidats, en cache par cellule.** `cell = H3(lat, lng, res 8)`. Clé `search:v1:p{productId}:g{all}.{gen}:c{cell}` (paquet `searchcache`), TTL `SEARCH_CACHE_TTL` (60 s). Le cache ne contient **que l'ensemble des stations candidates** (id, nom, marque, position de la station, quantité, fraîcheur, ouverte ou non, prochaine ouverture) et la stratégie : ni la position de l'utilisateur, ni un classement. Les candidats sont calculés depuis le **centre de la cellule** ; chaque rayon est augmenté du rayon circonscrit de la cellule (`h3.Circumradius`, ≈ 0,5 km en res 8), pour ne manquer aucune station dans le rayon autour de la position réelle.
3. **Rayons progressifs** `[500, 1000, 2000, 5000, 10000, 25000, 50000]` m (`ListOpenCandidatesWithin`, `LIMIT SEARCH_MAX_CANDIDATES` = 20, tri KNN `<->`). Filtres : `approved`, épinglée, horaires renseignés et ouverte maintenant, pas fermée aujourd'hui, produit actif vendu, `quantity > 0`, fraîcheur < 24 h, pas exclue par des signalements (cause à 5 auteurs ou plus : le produit, ou toute la station pour les autres motifs, `station_report_flags`). Une cause à 3 auteurs ou plus pose `reported: true` (badge « signalé »). Arrêt au premier rayon qui donne `SEARCH_MIN_RESULTS` (3) candidats ; au dernier rayon, 1 ou 2 suffisent. `strategy: "radius"`, `radiusM` = rayon atteint. Les fermetures du jour sont lues une fois par requête (`s.id NOT IN (…)`, sous-plan haché, index `idx_station_closures_day`).
4. **Repli (D19)** si aucune station ouverte à 50 km : KNN illimité sur les ouvertes (`ListOpenCandidatesKNN`, 10) et sur les stations en stock avec horaires (`ListStockedCandidatesKNN`, 20), dont on garde les fermées avec leur prochaine ouverture (`Schedule.NextOpening`). `strategy: "fallback"`, `radiusM: null`. Si rien : `strategy: "none"`, résultats vides (l'UI propose d'autres tailles ou produits).
5. **Classement par requête**, depuis la position exacte, **jamais mis en cache ni enregistré** : distance haversine, tri, 10 meilleurs, puis OSRM `/table` 1 → 10 (`sources=0&annotations=duration,distance`, timeout `OSRM_TIMEOUT`). Tri par durée (non joignables en fin) ; en repli, par heure à laquelle on peut être servi `servedAt = max(maintenant + trajet, prochaine ouverture)`, puis par trajet. Hors du Bénin ou si OSRM échoue (D21) : vol d'oiseau, durées estimées (détour × 1,3, 40 km/h), `routingApproximate: true`. Les erreurs OSRM journalisées sont expurgées de leur URL (qui contient les coordonnées).
6. **Stats anonymes (D23).** `HINCRBY stats:search:{heure}` sur `cellule res 7:produit:s` (et `:e` si aucune station ouverte à 5 km ou moins). Vidage par la tâche périodique `stats:flush` du worker (`STATS_FLUSH_INTERVAL`, 5 min) dans `search_stats` et ses agrégats `search_stats_daily` et `search_stats_totals` (D34) : RENAMENX puis upsert additif dans une seule transaction, sous verrou Redis, sans perte si l'écriture en base échoue.

### 4.2 Invalidation du cache

Toute écriture qui peut changer un résultat incrémente une **génération** (D18, paquet `searchcache`, après le commit). Les anciennes clés deviennent inaccessibles immédiatement et expirent par TTL.

| Écriture | Génération incrémentée |
|---|---|
| Saisie ou confirmation de stock | `search:gen:p{id}` de chaque produit vendu (la fraîcheur de tous change) |
| Statut (approve, reject, suspend, unsuspend, IFU/RCCM → pending, renvoi), position (épinglage, correction, déplacement validé), horaires, fermetures, produits vendus, correction des informations par l'admin, `make seed-dev` | `search:gen:all` |
| Catalogue (admin) : création, libellé, ordre, activation ou désactivation d'un produit | `search:gen:p{id}` |
| Signalement qui franchit un seuil (3 : badge, 5 : exclusion), ou traité (« autre ») ou classé sans suite par l'admin | `search:gen:p{id}` (rupture d'un produit) ou `search:gen:all` (autres motifs) |
| Mise à jour ou confirmation, ou changement de position, qui lève des effets de signalement (D32) | `search:gen:all` |

L'ouverture et la fermeture des stations au fil de la journée ne changent pas de génération : le TTL de 60 s borne le décalage, et un candidat dont le stock expire pendant ce délai est écarté au classement. Un échec d'invalidation n'annule pas l'écriture (journalisé, borné par le TTL).

On utilise des générations plutôt que `DEL` par motif, car une station qui repasse de 0 à > 0 doit apparaître dans des cellules dont le cache ne la contient pas encore ; un index inverse ne suffit pas. À l'échelle du Bénin (quelques milliers de stations), invalider largement reste bon marché.
Évolution possible si le taux de hit baisse : une génération par cellule H3 res 5, incrémentée sur le `gridDisk` couvrant 50 km autour de la station modifiée, plus la génération globale réservée aux résultats issus du repli.

### 4.3 Réponse

```json
{
  "product": { "id": 2, "code": "lpg_10kg", "label": "Gaz 10 kg", "unit": "cylinder" },
  "strategy": "radius",
  "radiusM": 2000,
  "routingApproximate": false,
  "results": [
    {
      "station": { "id": "0192…", "name": "Station Akpakpa", "brand": "…",
                   "location": { "lat": 6.3601, "lng": 2.4498 } },
      "distanceM": 1830,
      "routeDistanceM": 2400,
      "durationS": 420,
      "quantity": 14,
      "stale": false,
      "stockUpdatedAt": "2026-10-10T14:03:00Z",
      "updatedAgoS": 132,
      "isOpen": true,
      "nextOpening": null,
      "servedAt": "2026-10-10T14:12:12Z",
      "reported": false
    }
  ],
  "generatedAt": "2026-10-10T14:05:12Z"
}
```
`strategy` vaut `radius`, `fallback` ou `none`. `updatedAgoS` est calculé à la requête ; le client peut aussi recalculer « mis à jour il y a X min » depuis `stockUpdatedAt`. En-têtes : `Cache-Control: no-store`, `X-Cache: HIT|MISS` (candidats), `Server-Timing: db, osrm, total`.

### 4.4 Points d'attention et mesures
- **Ordre des coordonnées** : JSON `{lat,lng}`, mais PostGIS (`ST_MakePoint`) et OSRM attendent `lng,lat`. Des tests unitaires dédiés couvrent ce point.
- **Lagune de Cotonou** : la distance à vol d'oiseau trompe souvent (il faut passer par les ponts), d'où le minimum de 3 candidats avant le classement OSRM.
- **Confidentialité** : le journal d'accès masque toute valeur de query string hors liste blanche (`lat=***&lng=***`) ; aucune position dans Redis (clé = cellule), en base (stats = cellule res 7) ni dans les logs. Test d'intégration dédié.
- **Performance** (cible p95 < 150 ms hors cache, < 30 ms avec cache, hors OSRM). `make bench` (k6, 100 req/s, 60 s, 5 zones, 5 000 stations fictives) au 2026-10-10 : hors cache p50 7,5 / p95 12,9 / p99 21,6 ms ; avec cache p50 3,7 / p95 5,5 / p99 9,7 ms ; OSRM `/table` p95 5,8 ms ; HTTP de bout en bout p95 19,1 ms ; 44,8 % de hits. `make explain-search` vérifie l'usage de l'index GiST partiel (`idx_stations_location_approved`).

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
| `station.not_approved` | 403 | Station du gérant pas dans le statut requis ; extension `stationStatus` |
| `station.invalid_status_transition` | 409 | Décision impossible depuis le statut courant (ex. approuver une station approuvée) ; extension `stationStatus` |
| `station.manager_email_unverified` | 409 | Approbation refusée : email du gérant non vérifié |
| `station.location_outside_country` | 422 | Épingle hors du Bénin (frontière élargie de 2 km) |
| `station.closure_exists` | 409 | Une fermeture existe déjà à cette date |
| `search.out_of_coverage` | 422 | Position à plus de 30 km du Bénin (recherche), ou hors du Bénin (itinéraire) |
| `routing.no_route` | 422 | Aucun itinéraire routier vers la station |
| `routing.unavailable` | 503 | OSRM indisponible ou hors délai (l'itinéraire n'a pas de repli ; la recherche, si) |
| `station.no_products_sold` | 422 | Saisie ou confirmation de stock sans produit déclaré |
| `report.too_far` | 422 | Rupture ou fermeture signalée à plus de 2 km de la station (ou station sans position) |
| `report.duplicate` | 409 | Même station, même motif (et même produit) signalés il y a moins de 2 h |
| `report.daily_limit` | 429 | 10 signalements aujourd'hui (journée locale) |
| `report.reporting_suspended` | 403 | Droit de signaler retiré par l'admin après abus |
| `favorite.limit_reached` | 409 | 20 favoris déjà |
| `auth.account_disabled` | 403 | Connexion d'un compte désactivé par l'admin (seulement avec le bon mot de passe) |
| `user.admin_protected` | 403 | Action admin sur un compte admin (géré par la CLI) |
| `user.invalid_status` | 409 | Désactivation d'un compte non actif, réactivation d'un compte non désactivé ; extension `userStatus` |
| `user.already_verified` | 409 | Renvoi du code à un compte déjà vérifié |
| `product.already_exists` | 409 | Produit de même type (et même taille pour le gaz) déjà au catalogue |
| `export.not_ready` | 409 | Téléchargement d'un export en attente ou échoué ; extension `exportStatus` |
| `export.invalid_signature` | 403 | Lien de téléchargement altéré |
| `export.link_expired` | 410 | Lien de téléchargement de plus d'une heure (relire l'export pour un lien neuf) |
| `export.expired` | 410 | Fichier d'export supprimé (24 h après sa génération) |
| `resource.version_conflict` | 412 | `If-Match` périmé : recharger la ressource puis rejouer |
| `request.precondition_required` | 428 | En-tête `If-Match` absent sur une écriture verrouillée |
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

**Verrouillage optimiste** : les lectures de station (gérant et admin) renvoient `ETag: "v{version}"` ; toute écriture sur une station (et ce qui en dépend : horaires, fermetures, produits, stocks, décisions admin) exige `If-Match`.

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
| GET | `/auth/csrf` | ✅ Jeton CSRF de la session web (cookie d'accès, sinon cookie de refresh sans rotation), après un rechargement de page ; `Cache-Control: no-store` ; 401 sans session web |
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
| DELETE | `/me/devices/{id}` | ✅ Désenregistre un appareil (404 pour celui d'un autre compte ; email vérifié non exigé) |

### Recherche et itinéraire : publics, connexion facultative
Quotas de `/search` et `/routes` (D22) : 300/min par IP + 30/min par installation (`X-Install-Id`) ou par utilisateur connecté. Les positions reçues ne sont jamais stockées ni journalisées.

| Méthode | Route | Description |
|---|---|---|
| GET | `/search?lat&lng&product_id` | ✅ Recherche (§4), badge `reported`. 422 `search.out_of_coverage` au-delà de 30 km de la frontière |
| GET | `/stations/{id}` | ✅ Fiche publique d'une station `approved` (404 sinon) : infos, horaires et fermetures à venir, stocks des produits vendus avec `freshness` (quantité masquée si expirée) et `reported` ; `reported` au niveau de la station (fermée, position, autre) |
| GET | `/routes?lat&lng&station_id` | ✅ Itinéraire OSRM (`polyline6`, `overview=full`, `steps=true`) : distance, durée, géométrie, étapes structurées sans texte (manœuvre `type`/`modifier`/`exit`, rue, distance, durée) traduites par le mobile (`osrm-text-instructions`, `fr`). Position hors du Bénin → 422 `search.out_of_coverage` ; pas de route → 422 `routing.no_route` ; OSRM indisponible → 503 `routing.unavailable` |

### Fonctions réservées aux comptes vérifiés 🔒 (`RequireVerifiedEmail`)
| Méthode | Route | Description |
|---|---|---|
| POST | `/stations/{id}/reports` | ✅ `{ reason, productId?, comment?, position? }` : `out_of_stock` (produit vendu), `station_closed`, `wrong_location`, `other` (commentaire ≤ 300). Rupture et fermeture : `position` à 2 km au plus, jamais stockée. 1 par station et par motif / 2 h, 10 par jour. Effets : 3 auteurs → badge + notification au gérant ; 5 → exclusion + alerte admin (D29) |
| GET | `/me/favorites` | ✅ Favoris (station, `available`, `alertProductIds`) |
| POST / DELETE | `/me/favorites/{stationId}` | ✅ Ajouter (201, ou 200 si déjà là ; `alertProductIds` remplace les produits suivis) / retirer (idempotent). 20 au plus (D30) |
| POST | `/me/devices` | ✅ `{ token, platform, installId, language?, appVersion? }` : token Expo de l'installation, lié à la session courante ; à rappeler à chaque lancement (D26) |
| GET | `/me/notifications?cursor&limit` | ✅ Boîte de réception (30 jours) : `type`, `data`, `readAt` ; `unreadCount` |
| POST | `/me/notifications/read` | ✅ `{ ids }` ou `{ all: true }` → `unreadCount` |
| GET / PUT | `/me/notification-settings` | ✅ Préférences par type (opt-out) : `back_in_stock` ; gérants : `stock_reminder`, `station_reported` |

### Gérant 🔒 `manager` (`RequireStationStatus`)
Gérant `pending` ou `suspended` : rien d'autre que son compte (`/me` montre le statut), toute route gérant répond 403 `station.not_approved`. Gérant `rejected` : consultation, correction et renvoi du justificatif. Toutes les écritures exigent `If-Match`.

| Méthode | Route | Statuts | Description |
|---|---|---|---|
| GET | `/manager/station` | approved, rejected | ✅ Station, signalement d'épingle, demande de déplacement en attente, checklist `setup` (position, horaires, produits, stocks) et `missing` : ce qui manque pour apparaître dans la recherche ; `ETag` |
| PATCH | `/manager/station` | approved, rejected | ✅ Nom, marque, adresse, ville, téléphone, IFU, RCCM. IFU ou RCCM modifié sur une station approuvée → `pending` |
| POST | `/manager/station/resubmission` | rejected | ✅ Nouveau justificatif (multipart) → `pending` ; l'ancien est supprimé |
| PUT | `/manager/station/location` | approved | ✅ `{ lat, lng, confirmStationLocation: true, device?: { lat, lng, accuracyM } }` : hors Bénin → 422 ; premier épinglage ou correction < 200 m → 200 ; déplacement ≥ 200 m → 202 (demande en attente) ; épingle à plus de 500 m de l'appareil → signalée |
| GET / PUT | `/manager/station/opening-hours` | approved | ✅ Semaine complète : 2 plages par jour au plus, `is24h`, `allWeek24h` ; `isOpenNow`, `nextOpening`, fermetures à venir |
| POST | `/manager/station/closures` | approved | ✅ `{ date, reason? }` : journée entière, aujourd'hui ou dans l'année |
| DELETE | `/manager/station/closures/{id}` | approved | ✅ Supprime une fermeture |
| GET / PUT | `/manager/station/products` | approved | ✅ Catalogue + `sold` ; PUT `{ productIds }` = liste complète des produits vendus (nouveau produit à 0) |
| GET | `/manager/station/stocks` | approved | ✅ Quantités, plafonds, `updatedAt`, `lastConfirmedAt`, `freshness` (fresh, stale, expired) |
| PUT | `/manager/station/stocks` | approved | ✅ Saisie groupée `{ items: [{ productId, quantity }] }`, un élément par produit vendu ; historique des changements ; vaut confirmation |
| POST | `/manager/station/stocks/confirm` | approved | ✅ « Rien n'a changé » : `last_confirmed_at = now()` pour tous les produits vendus |
| GET | `/manager/station/stocks/history?productId&from&to` | approved | Historique (plus tard) |
| GET | `/manager/reports?status=open\|all&cursor&limit` | approved | ✅ Effets en cours (`flags` : motif, produit, niveau `flagged`/`excluded`) et signalements, sans l'identité ni le commentaire des auteurs |
| POST | `/manager/reminders/mute` | approved | ✅ Sourdine des rappels jusqu'à la fermeture du jour (fin de la dernière plage, minuit à défaut) → `mutedUntil` |

### Admin 🔒 `admin` (session web ouverte après 2FA, cookie + CSRF ; chaque décision est auditée)
Toutes les routes `/admin/*` exigent la session web (cookie `__Host-gs_at`, claim `mfa`) : un Bearer y est refusé (403), le jeton CSRF est donc contrôlé sur toute écriture (D40). Paramètres de requête inconnus ou répétés → 400 ; listes paginées par curseur (`?limit=&cursor=` → `{ items, nextCursor }`).

| Méthode | Route | Description |
|---|---|---|
| GET | `/admin/dashboard?period&from&to` | ✅ Tableau de bord en un appel (D33) : stations par statut, dossiers en attente et ancienneté du plus vieux, fraîcheur des stocks, gérants inactifs, recherches (total, par produit, part sans station ouverte à 5 km), top des zones en pénurie, signalements et alertes ouverts, inscriptions ; évolution sur la période précédente ; séries (recherches par tranche et par produit, fraîcheur moyenne) |
| GET | `/admin/counters` | ✅ Badges de la barre latérale : dossiers en attente (email vérifié), signalements et alertes ouverts, épingles à vérifier ; `no-store`, interrogé toutes les 60 s |
| GET | `/admin/stats/searches?period&from&to&productId` | ✅ Séries des recherches et répartition par heure de la journée, tous lieux confondus (D34) |
| GET | `/admin/stats/shortages?period&from&to&productId&onlyShortages` | ✅ GeoJSON des cellules H3 res 7 avec leur taux ; cellules de moins de 5 recherches masquées (`maskedCells`) (D34) |
| GET | `/admin/stations?status&q&needsReview&freshness&managerInactive&noHours&reported&excluded&cursor&limit` | ✅ Stations d'un statut (défaut `pending`, `all` = tous), recherche par nom ou préfixe d'IFU ; filtres : `needsReview` (épingle signalée ou déplacement en attente), `freshness=stale` (8 à 24 h) ou `expired` (plus de 24 h ou jamais), gérant inactif, sans horaires, signalée, exclue (seuil de 5 signalements atteint, produit ou station) (D35). Un dossier `pending` n'apparaît qu'une fois l'email du gérant vérifié (D5) |
| GET | `/admin/stations/map?status` | ✅ GeoJSON léger de toutes les stations épinglées (statut, fraîcheur, signalée), regroupement côté client |
| GET | `/admin/stations/{id}` | ✅ Détail : gérant, justificatif, signalement, demande de déplacement, `statusChangedAt`, horaires et fermetures à venir, stocks et leur fraîcheur (lecture seule) ; `ETag` |
| PATCH | `/admin/stations/{id}` | ✅ Correction (nom, marque, adresse, ville, téléphone, IFU, RCCM) avec `reason` obligatoire, `If-Match`, audit avant/après, email au gérant ; statut inchangé ; aucune modification des stocks |
| GET | `/admin/stations/{id}/document` | ✅ Justificatif déchiffré (téléchargement forcé, `Cache-Control: no-store`, CSP `sandbox`, audité) |
| POST | `/admin/stations/{id}/approve` | ✅ `pending → approved` (email du gérant vérifié requis) ; email au gérant |
| POST | `/admin/stations/{id}/reject` | ✅ `{ reason }` : `pending → rejected` ; email au gérant avec le motif |
| POST | `/admin/stations/{id}/suspend` | ✅ `{ reason }` : `approved → suspended` ; email au gérant |
| POST | `/admin/stations/{id}/unsuspend` | ✅ `{ reason }` : `suspended → approved` ; email au gérant |
| POST | `/admin/stations/{id}/location-requests/{requestId}/approve` | ✅ Applique la nouvelle position (et sa cellule H3) ; clôt les signalements « position incorrecte » |
| POST | `/admin/stations/{id}/location-requests/{requestId}/reject` | ✅ `{ reason }` : position inchangée |
| POST | `/admin/stations/{id}/location-flag/dismiss` | ✅ Lève le signalement d'épingle |
| GET | `/admin/reports?status&reason&stationId&cursor&limit` | ✅ Signalements avec commentaire et auteur (nombre de signalements abusifs, droit retiré) |
| POST | `/admin/reports/{id}/resolve` | ✅ `{ note? }` : traité ; l'effet reste jusqu'à la correction de la cause (stock, position), sauf « autre », recalculé (D32) |
| POST | `/admin/reports/{id}/dismiss` | ✅ `{ abusive?, note? }` : classé sans suite (abusif) ; l'effet de la cause est recalculé sur les signalements encore ouverts |
| GET | `/admin/alerts?status&kind&cursor&limit` | ✅ Alertes `manager_inactive` (3 rappels ignorés) et `reports_threshold` (5 signalements) |
| POST | `/admin/alerts/{id}/resolve` | ✅ `{ note? }` : clôt une alerte |
| GET | `/admin/users?q&role&status&emailVerified&cursor&limit` | ✅ Comptes, recherche par nom ou email (D36) |
| GET | `/admin/users/{id}` | ✅ Profil, sessions actives (nombre), appareils, signalements (total et abusifs), favoris, station du gérant |
| POST | `/admin/users/{id}/disable` | ✅ `{ reason }` : désactive (sessions et appareils révoqués, connexion refusée `auth.account_disabled`) |
| POST | `/admin/users/{id}/reactivate` | ✅ `{ reason }` : réactive |
| POST | `/admin/users/{id}/resend-verification` | ✅ `{ reason }` : renvoie le code de vérification (compte actif non vérifié, 1/min et 5/h) → 202 |
| POST | `/admin/users/{id}/reporting-ban` | ✅ `{ reason }` : retire le droit de signaler |
| POST | `/admin/users/{id}/reporting-ban/lift` | ✅ `{ reason }` : rend le droit de signaler |
| GET | `/admin/products?cursor&limit` | ✅ Catalogue complet, désactivés compris, avec le nombre de stations qui vendent chaque produit (D37) |
| POST | `/admin/products` | ✅ `{ kind, sizeKg?, label, sortOrder?, active? }` : code dérivé (`lpg_12_5kg`) ; type, unité et taille figés ensuite |
| PATCH | `/admin/products/{id}` | ✅ Libellé, ordre, activation (champs figés → 422 `immutable`) ; aucune suppression ; cache du produit invalidé |
| GET | `/admin/audit?actorId&action&entityType&entityId&from&to&cursor&limit` | ✅ Journal d'audit en lecture seule ; `action` exacte ou préfixe `admin.*` (D38) |
| GET / POST | `/admin/exports` | ✅ Exports récents / lance un export `{ dataset, format?, from?, to?, productId? }` → 202 (D39) |
| GET | `/admin/exports/{id}` | ✅ Statut et lien de téléchargement signé valable 1 h |
| GET | `/admin/exports/{id}/download?expires&signature` | ✅ Fichier déchiffré (lien signé + session admin, pièce jointe, audité) ; 410 si le lien ou le fichier a expiré |
| GET | `/admin/data-requests?status` | Demandes APDP (étape 9) |
| PATCH | `/admin/data-requests/{id}` | Traitement (statut, note, génération d'export) (étape 9) |

Les comptes admin se créent uniquement via la CLI `cmd/admin` (`make admin-create`) : aucune route publique. Toutes les routes admin exigent une session web ouverte après 2FA (claim `mfa`), par cookie (`RequireCookieSession`).

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
- **Autorisation** : `Authenticate` (Bearer ou cookie) → `RequireRole` → `RequireVerifiedEmail` / `RequireApprovedStation`. Ces deux derniers lisent l'état en base à chaque requête : une suspension ou une vérification prend effet immédiatement. Les routes admin ajoutent `RequireCookieSession` : session web uniquement, donc CSRF toujours contrôlé.
- **Compte désactivé par l'admin** : sessions révoquées (et appareils push avec elles), tokens push restants supprimés ; le login répond 403 `auth.account_disabled`, mais seulement avec le bon mot de passe (sinon `auth.invalid_credentials`, pas d'énumération) ; un refresh échoue.
- **Rate limiting** (Redis, fenêtre glissante, sans arrondi : pas de requête de trop au changement de fenêtre) :

  | Action | Limite |
  |---|---|
  | Global `/api/v1` | 1 200/min par IP (`RATE_LIMIT_IP_REQUESTS` / `RATE_LIMIT_IP_WINDOW`, D22) |
  | Login (`/auth/login`, `/auth/admin/login`) | 5/min par IP **et** 5/min par email (empreinte HMAC) |
  | Inscription (utilisateur et gérant) | 10/h par IP |
  | Vérification de codes (email, reset, 2FA) | 30 / 10 min par IP, et 5 essais par code ou défi |
  | Envoi d'emails (resend, forgot) | 20/h par IP, et 1/min puis 5/h par compte |
  | Recherche et `/routes` (publics) | 300/min par IP + 30/min par installation (`X-Install-Id`) ou par utilisateur (D22) |
  | Signalements | 1 par station et par motif toutes les 2 h, 10 par jour et par utilisateur : comptés en base sur les signalements acceptés, sous verrou consultatif |
  | Favoris | 20 par compte |

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
  - actions admin : création et reset 2FA par la CLI, lecture de justificatif, décisions et corrections de station (motif, avant/après), modération des signalements (traité, classé, abusif), retrait et rétablissement du droit de signaler (motif), clôture des alertes, désactivation et réactivation de compte, renvoi du code de vérification (motif), création et modification de produit (avant/après), demande et téléchargement d'export.
- **Divers** : CORS limité à `CORS_ALLOWED_ORIGINS`, avec credentials. Corps bornés (1 Mo en JSON, 5 Mo + 256 Ko pour l'inscription gérant). `Cache-Control: no-store` sur les réponses contenant des tokens.

## 7. Jobs asynchrones (asynq)

`cmd/worker` est un processus séparé (même image que l'API, entrypoint `/app/worker`) : il exécute les tâches et leur **scheduler**. Il tourne en **une seule instance** tant que le scheduler n'est pas séparé : asynq n'élit pas de leader, deux schedulers enregistreraient chaque tâche périodique deux fois (les clés d'unicité limitent les doublons, sans les exclure). Supervision en dev : asynqmon (`make up`, http://127.0.0.1:8090). Sondes `/healthz` et `/readyz` (PostgreSQL, Redis) sur `WORKER_HEALTH_ADDR`.

L'API ne fait que mettre en file (`jobs.Client`) : une panne SMTP ou Expo ne ralentit aucune requête.

| Tâche | Déclenchement | File | Rôle |
|---|---|---|---|
| `email:send` | Chaque email (`mail.Queue`) | default | ✅ Charge utile chiffrée (AES-256-GCM, clé dérivée d'`APP_SECRET`) : ni adresse ni code en clair dans Redis. Envoi SMTP ; une réponse d'erreur SMTP n'est journalisée que par son code. 10 retries |
| `push:send` | Après chaque notification | critical | ✅ Appareils des destinataires (sessions encore actives), push par lots de 100 vers Expo, notification marquée remise lot par lot (un retry ne renvoie rien), `DeviceNotRegistered` immédiat → token supprimé. 5 retries |
| `push:receipts` | 15 min après l'envoi (`PUSH_RECEIPTS_DELAY`) | low | ✅ Reçus Expo par lots de 1 000 ; `DeviceNotRegistered` → token supprimé (s'il n'a pas changé entre-temps, empreinte SHA-256) |
| `favorites:back_in_stock` | Saisie de stock 0 → > 0 | default | ✅ Alertes des abonnés (limites et heures calmes, D30) |
| `favorites:release` | `*/15 * * * *` | low | ✅ Hors heures calmes : envoie les alertes en attente si le stock est toujours positif (la première passe à 7 h), abandonne les autres |
| `reminders:scan` | `*/15 * * * *` | low | ✅ Rappels de stock et escalade des séries ignorées (D28) |
| `stats:flush` | `@every 5m` (`STATS_FLUSH_INTERVAL`) | low | ✅ Compteurs Redis → `search_stats` et ses agrégats `search_stats_daily` (jour local) et `search_stats_totals` (tous lieux), même transaction (upsert additif, verrou Redis, sans perte) |
| `stats:freshness` | `0 * * * *` | low | ✅ Relevé de la fraîcheur des stocks par produit (frais, stale, exclus) dans `stock_freshness_stats` (séries du tableau de bord) |
| `export:generate` | À la demande (`POST /admin/exports`) | default | ✅ Lit le jeu de données, écrit le CSV (BOM, « ; ») ou le JSON, chiffre (enveloppe), stocke, marque l'export prêt (fichier supprimé à +24 h). 3 retries ; au dernier échec, ou au-delà de 200 000 lignes, l'export est marqué échoué |
| `export:purge` | `*/15 * * * *` | low | ✅ Supprime les fichiers d'export de 24 h ou plus (statut `expired`) et déclare échouées les demandes en attente depuis plus d'une heure |
| `retention:purge` | `0 3 * * *` | low | ✅ Règles de l'étape 6 (notifications et journal des alertes à 30 j, tokens push sans réenregistrement à 90 j) ; emplacement prêt pour les règles de l'étape 9 (§8) |
| `data-requests:export` | À la demande | — | Étape 9 : archive JSON des données d'un utilisateur, chiffrée, lien valable 7 j |

Les horaires du scheduler sont en heure locale (`Africa/Porto-Novo`). **Retries** : backoff exponentiel `JOBS_RETRY_BASE_DELAY × 2^n` (± 25 %), plafonné à `JOBS_RETRY_MAX_DELAY` ; une charge utile illisible part aux archives sans retry. Les tâches périodiques portent une clé d'unicité (pas d'empilement si le worker prend du retard) et peu de retries (la suivante repasse). Files pondérées `critical` 6, `default` 3, `low` 1. Les tâches réussies ne sont pas conservées ; les archivées (échec définitif) le sont par asynq (90 j au plus), sans donnée personnelle en clair.

Emails de statut de station (D16 + étape 5) : décisions de l'admin (validation, refus, suspension, réactivation, déplacement validé ou refusé avec motif), accusés de réception quand la station repasse en `pending` à l'initiative du gérant (IFU ou RCCM modifié, renvoi du justificatif), et « rappels suspendus » après 3 rappels ignorés (étape 6).

## 8. Données personnelles et conservation

| Donnée | Base légale / finalité | Conservation proposée* |
|---|---|---|
| Position de l'utilisateur | Exécution du service (recherche, itinéraire) | **Aucune** : traitée en mémoire, jamais journalisée |
| Position de l'appareil du gérant à l'épinglage | Contrôle de vraisemblance (D13) | **Aucune** : seules la distance à l'épingle et la précision GPS sont conservées (signalement, demande de déplacement) |
| Stats de recherche (H3 res 7, par heure) et leurs agrégats (par jour ; tous lieux par heure) | Intérêt légitime (pénuries) | 24 mois, déjà anonymes ; affichées et exportées seulement au-delà de k ≥ 5 recherches |
| Relevés de fraîcheur des stocks | Intérêt légitime (fiabilité) | 24 mois (aucune donnée personnelle) |
| Fichiers d'export admin | Pilotage, conformité | **24 h** après la génération (purge toutes les 15 min) ; chiffrés ; auteurs des signalements pseudonymisés, jamais d'email ; jamais la liste des utilisateurs |
| Demandes d'export (métadonnées) | Responsabilité | 12 mois (étape 9) |
| Compte utilisateur | Contrat | Durée du compte ; purge 30 j après la demande de suppression |
| Comptes inactifs | Minimisation | Relance à 24 mois, suppression à 36 mois |
| Justificatif IFU d'une station approuvée | Obligation de vérification | Tant que la station est active + 12 mois |
| Justificatif d'une demande rejetée | Idem | 90 j après le rejet |
| Refresh tokens et sessions | Sécurité | 30 j glissants (12 h pour les admins), TTL Redis ; supprimés au logout et à la révocation |
| Codes à 6 chiffres, défis 2FA | Sécurité | 15 min / 5 min (TTL Redis), détruits après usage ou 5 échecs |
| Codes de secours 2FA | Sécurité | Jusqu'à usage, remplacement ou reset ; supprimés avec le compte |
| Tokens push | Exécution du service | Jusqu'à la révocation de leur session (logout, révocation, changement ou réinitialisation du mot de passe, suppression du compte), `DeviceNotRegistered`, ou 90 j sans réenregistrement (purge quotidienne) |
| Boîte de réception (notifications) | Exécution du service | 30 j (purge quotidienne) ; supprimée avec le compte |
| Préférences de notification | Exécution du service | Durée du compte |
| Journal des alertes « de retour en stock » | Limites de fréquence | 30 j |
| Position de l'auteur d'un signalement | Contrôle de vraisemblance (2 km) | **Aucune** : traitée en mémoire, jamais journalisée |
| Alertes admin | Modération | 12 mois après résolution (étape 9) |
| Historique des stocks | Intérêt légitime (fiabilité, stats) | 24 mois, puis agrégé |
| Signalements | Modération | 12 mois après résolution ; `reporter_id` mis à NULL à la suppression du compte. Le gérant ne voit jamais l'auteur ni le commentaire |
| Journal d'audit | Sécurité, responsabilité | 12 mois |
| Demandes d'exercice des droits | Preuve de conformité | 3 ans après clôture |
| Logs applicatifs (sans position ni token) | Sécurité | 30 j |

\* Durées à valider avec un juriste ou DPO au regard du Code du numérique (Livre V) et des délibérations de l'APDP.

## 9. Décisions et questions ouvertes

### Décisions (2026-10-10 ; D25 à D45 : 2026-10-11 ; D46 à D55 : 2026-10-12 ; D56 et D57 : 2026-10-13)

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
| D11 | Validation admin | **Dès l'étape 4** : liste des stations par statut (pagination par curseur, recherche par nom ou IFU), détail, `approve`, `reject` (motif obligatoire), `suspend` / `unsuspend` (motif obligatoire), validation des demandes de déplacement. Email au gérant à chaque changement de statut décidé par l'admin. Tout est audité. Le reste de l'API admin : étape 7 (D33 à D40). |
| D12 | Horaires | Fuseau `Africa/Porto-Novo`. Jusqu'à **2 plages par jour**, plages qui passent minuit acceptées. Raccourci 24 h/24 par jour ou pour toute la semaine. **Fermetures exceptionnelles** (date, journée entière, motif facultatif) qui couvrent aussi les jours fériés. `IsOpen(station, instant)` testée sur les cas limites. |
| D13 | Position | Refus hors Bénin : polygone Natural Earth (domaine public) chargé par migration, testé avec `ST_Covers` sur la frontière élargie de **2 km**. **Premier épinglage libre** ; l'app envoie aussi la position et la précision GPS de l'appareil, et une épingle à **plus de 500 m** de l'appareil est signalée à l'admin, sans blocage. **Déplacement ensuite** : moins de 200 m, c'est libre (correction GPS) ; au-delà, c'est une demande de déplacement validée par l'admin, l'ancienne position restant active en attendant. Cellule H3 res 8 calculée à l'épinglage. |
| D14 | Champs de la station | Un changement d'**IFU ou de RCCM** renvoie une station approuvée en `pending`. Le reste (nom, marque, adresse, ville, téléphone) est modifiable librement. |
| D15 | Rejet | Le gérant rejeté peut corriger ses informations et **renvoyer un justificatif** (exception au blocage pour le statut `rejected`). La station repasse alors en `pending`. |
| D16 | Stocks | Le gérant **déclare les produits qu'il vend**. « Non vendu » (pas de ligne) ≠ « 0 en stock » : les deux sont exclus de la recherche, mais seul le 0 compte comme rupture dans les stats. Plafonds configurables : 10 000 bouteilles par taille, 200 000 litres par carburant. Mise à jour groupée en un seul appel, chaque changement écrit dans `stock_history`. Endpoint « rien n'a changé » qui pose `last_confirmed_at` (distinct de `updated_at`). **Fraîcheur** (stale à 8 h, exclusion à 24 h) = le plus récent des deux. |
| D17 | Rappels push | Faits à l'étape 6 avec **asynq** (D25, D28), qui a aussi remplacé la file d'emails en mémoire. |
| D18 | Cache de recherche | Invalidé à chaque écriture de stock (produits concernés), de statut, d'horaires, de fermeture, de produits vendus ou de position (tous les produits). |
| D19 | Fermées en repli | Quand aucune station ouverte n'est trouvée à 50 km : stations ouvertes au-delà (KNN illimité) et stations fermées, triées par **heure à laquelle on peut être servi** = `max(maintenant + trajet, prochaine ouverture)`, puis par trajet. Les stations sans horaires sont exclues de la recherche. |
| D20 | Couverture | Utilisateur au Bénin (frontière élargie de 2 km) → classement OSRM. Hors du Bénin mais à **30 km** de la frontière ou moins → classement à vol d'oiseau, flag `routingApproximate`. Au-delà → 422 `search.out_of_coverage`. |
| D21 | Résilience du routage | OSRM en erreur ou hors délai → repli sur le vol d'oiseau avec le même flag `routingApproximate` (durées estimées). |
| D22 | Rate limit de la recherche | **300/min par IP** (beaucoup d'abonnés mobiles partagent la même IP) **+ 30/min par installation** (en-tête `X-Install-Id`, UUID généré par l'app) ou par utilisateur connecté. Le quota global de `/api/v1` passe à 1 200/min par IP pour ne pas être plus strict. |
| D23 | Stats anonymes de recherche | Cellule H3 res 7, produit, tranche horaire, nombre de recherches, nombre de recherches sans station ouverte à moins de 5 km (signal de pénurie). Aucun identifiant utilisateur ni position exacte. Compteurs Redis vidés en base périodiquement. |
| D24 | Itinéraire | OSRM `route` (polyline6, `overview=full`, `steps=true`). L'API renvoie des étapes structurées (type et modifier de la manœuvre, rue, distance, durée), sans texte ; le mobile les traduit en français avec `osrm-text-instructions` (langue `fr`). |
| D25 | Worker | `cmd/worker`, processus séparé (asynq v0.26) : tâches et scheduler, **une seule instance** pour l'instant. Emails (fin de la file en mémoire) et vidage des stats migrés en tâches avec retry et backoff exponentiel. Purges dans `retention:purge`, prête pour l'étape 9. Service `worker` dans docker-compose (profil `api`), asynqmon (profil `dev`). |
| D26 | Push | Interface `Pusher` : **Expo** (lots de 100, reçus lus après 15 min, tokens `DeviceNotRegistered` supprimés) ou **Fake** (dev et tests : journalise le type, sans donnée personnelle) si `EXPO_ACCESS_TOKEN` est vide. Un appareil = une installation (`installId`), **lié à sa session** : sa révocation ou le logout supprime le token ; à l'envoi, un appareil dont la session a expiré est écarté et supprimé. Texte des push rendu par le serveur dans la langue de l'appareil (`fr`, `en` prêt). |
| D27 | Notifications | Boîte de réception (`notifications`, 30 jours) : `type` + `data`, l'app compose le texte. Préférences par type en opt-out. Types : `stock_reminder`, `station_reported` (gérants), `back_in_stock`. Réservé aux emails vérifiés ; aucun push pour les admins. |
| D28 | Rappels gérant | Tâche toutes les 15 min. Rappel si : ouverte maintenant, dernière mise à jour ou confirmation **et** dernier rappel de plus de 4 h, moins de 4 rappels aujourd'hui, pas de sourdine, pas d'opt-out. Catégorie Expo `stock_reminder`, actions « Mettre à jour » (ouvre l'app) et « Rien n'a changé » (POST `/manager/station/stocks/confirm` avec l'ETag du push en `If-Match`, sans ouvrir l'app). À l'échéance qui suit **3 rappels ignorés de suite** : pas de 4e rappel, arrêt pour la journée du dernier rappel, email au gérant, alerte admin « gérant inactif » ; reprise le lendemain. Sourdine (`POST /manager/reminders/mute`) jusqu'à la fermeture du jour. |
| D29 | Signalements | Comptes vérifiés. Motifs : `out_of_stock` (par produit), `station_closed`, `wrong_location`, `other` (≤ 300 caractères). Rupture et fermeture : position de l'auteur à 2 km au plus, jamais stockée ni journalisée. Limites : 1 par station et par motif / 2 h, 10 par jour. Effets (auteurs distincts, 2 h, même cause) : 3 → badge `reported` + notification au gérant (sans auteurs) ; 5 → exclusion de la recherche (le produit, ou la station pour les autres motifs) + alerte admin. Clôture automatique : voir D32 (correctif de l'étape 7). Admin : traité, classé (abusif, avec recalcul de l'effet), retrait du droit de signaler. |
| D30 | Favoris | 20 au plus, stations approuvées. Alerte « de retour en stock » facultative par produit, au passage de 0 à plus de 0 ; 1 par station et par produit / 6 h, 5 par jour et par utilisateur ; rien entre 21 h et 7 h (heure de Porto-Novo) : l'alerte attend et part à 7 h si le stock est toujours positif. Pas d'alerte de réouverture. |
| D31 | Règles mobile | Station fermée : « Fermée · rouvre à HH:MM ». `/routes` en 503 : ligne droite vers la station et « Ouvrir dans une autre app » (intent `geo:`). Voir CLAUDE.md, règles mobile. |
| D32 | Clôture des signalements (correctif) | Une saisie ou une confirmation des stocks ne clôt que les ruptures (`out_of_stock`) des produits saisis ou confirmés, et « station fermée ». « Position incorrecte » se clôt quand la position active change (correction du gérant, déplacement validé) ou par l'admin. « Autre » ne se clôt que par l'admin. Les effets (badge, exclusion) et l'alerte « seuil » des causes closes sont levés. « Traité » par l'admin : l'effet reste jusqu'à la correction de la cause (stock, position) ; pour « autre », qui n'a pas de correction automatique, il est recalculé sur les signalements encore ouverts. Un produit qui n'est plus vendu (ou désactivé) n'est pas concerné par la saisie : ses signalements attendent l'admin. |
| D33 | Tableau de bord | `GET /admin/dashboard` en un appel : stations par statut, dossiers en attente et ancienneté du plus vieux (`status_changed_at`, tenu par trigger), fraîcheur des stocks (frais < 8 h, stale, exclus > 24 h), gérants inactifs (alertes ouvertes), recherches par produit, part sans station ouverte à 5 km, top 10 des zones en pénurie (par recherches sans résultat), signalements et alertes ouverts, inscriptions (utilisateurs, gérants). Évolution sur la période précédente de même durée (`change` relatif, null si 0). Séries : recherches par tranche et par produit ; fraîcheur moyenne des relevés horaires (`stock_freshness_stats`, tâche `stats:freshness` : la fraîcheur passée ne se reconstitue pas, les confirmations n'étant pas historisées). Les indicateurs instantanés (statuts, fraîcheur, alertes) n'ont pas d'évolution. |
| D34 | Stats et pénuries | Zone en pénurie : cellule H3 res 7 où au moins 50 % des recherches n'ont trouvé aucune station ouverte à 5 km. Périodes : 24 h (par heure, heure en cours comprise), 7 jours (défaut) et 30 jours en jours locaux, aujourd'hui compris jusqu'à maintenant (la période précédente s'arrête à la même heure), plage personnalisée de dates (366 jours au plus). Anonymat : k ≥ 5 recherches sur l'agrégat affiché (cellule × produit filtré ou tous produits × période) ; en dessous, la cellule est masquée (seul leur nombre est donné) ; les agrégats tous lieux confondus ne descendent jamais à la cellule. Performance (p95 < 300 ms sur seed-dev) : agrégats `search_stats_daily` et `search_stats_totals` tenus par `stats:flush` dans la même transaction (pas de vue matérialisée : un rafraîchissement recalcule tout l'historique) ; requêtes exécutées sans plan mis en cache (le plan générique sous-estimait les lignes et doublait les temps). `make explain-stats`, `make bench-stats`. |
| D35 | Stations (admin) | Carte : GeoJSON léger de toutes les stations épinglées (statut, fraîcheur de la dernière saisie, signalée), regroupement côté client. Filtres de liste : `freshness=stale` (8 à 24 h), `expired` (plus de 24 h ou jamais saisi), gérant inactif, sans horaires, signalée ; `status=all`. Correction `PATCH /admin/stations/{id}` : nom, marque, adresse, ville, téléphone, IFU, RCCM, motif obligatoire, `If-Match`, audit avant/après, email au gérant, statut inchangé (l'admin est le valideur), cache invalidé. Jamais de modification des stocks par l'admin. |
| D36 | Comptes (admin) | Liste paginée (recherche dans l'email, le prénom, le nom), filtres rôle, statut, email vérifié ; fiche (profil, sessions actives, appareils, signalements total et abusifs, favoris, station). Actions avec motif et audit : désactiver (sessions et appareils révoqués, login 403 `auth.account_disabled` avec le bon mot de passe), réactiver, rétablir le droit de signaler (`/reporting-ban/lift`, remplace le DELETE de l'étape 6), renvoyer le code de vérification (limites habituelles). Comptes admin intouchables (CLI). Pas de modification du nom ou de l'email ni de suppression (étape 9). La station d'un gérant désactivé n'est pas suspendue : sans mise à jour, elle sort de la recherche à 24 h. |
| D37 | Catalogue | Création (gaz : 0,5 à 100 kg au centième ; carburants : sans taille), code dérivé (`lpg_12_5kg`) ; type, unité et taille figés (422 `immutable`) ; libellé, ordre et activation modifiables ; aucune suppression. Un produit désactivé sort de la recherche (422), du catalogue public et des choix et de la saisie du gérant ; ses stocks et son historique restent. Invalidation `search:gen:p{id}` à chaque écriture. |
| D38 | Audit | `GET /admin/audit` en lecture seule : filtres acteur, action (exacte ou préfixe `admin.*`), cible (type, identifiant), période (dates locales ou RFC 3339) ; curseur (created_at, id). Index dédiés. |
| D39 | Exports | `POST /admin/exports` → tâche `export:generate` ; `GET /admin/exports/{id}` : statut et lien signé (HMAC) valable 1 h, à utiliser avec la session admin. Jeux : stations (IFU, RCCM), stocks actuels, stats agrégées par cellule et produit (k ≥ 5), signalements (auteur pseudonymisé par HMAC, jamais l'email), audit. CSV UTF-8 avec BOM, « ; », CRLF, décimaux à virgule, dates en heure locale, cellules de texte neutralisées contre l'injection de formules ; JSON en option. Période par défaut : 30 jours. Fichier chiffré (enveloppe), supprimé 24 h après sa génération (`export:purge`). Jamais la liste des utilisateurs. Demande et téléchargement audités. API et worker partagent le stockage (volume `documents`). |
| D40 | Accès admin | Toutes les routes `/api/v1/admin/*` : rôle admin avec 2FA (claim `mfa`), session web par cookie uniquement (Bearer refusé), donc CSRF sur toute écriture. Validation stricte : JSON sans champ inconnu, paramètres de requête inconnus ou répétés refusés (400), pagination par curseur partout. |
| D41 | Graphiques (admin web) | Composants **Chart de shadcn/ui** (Recharts). Palette catégorielle validée pour la vision des couleurs, en ordre fixe (la couleur suit le produit, jamais son rang) ; statuts de fraîcheur réservés, toujours avec icône et libellé ; un seul axe ; chaque graphique a un résumé textuel, un tableau pour les lecteurs d'écran et une vue tableau visible. Rendus une fois à leur taille mesurée, dans un chunk chargé à part. Détail : `Web/docs/design-system.md`. |
| D42 | Thème (admin web) | Suit le système (`prefers-color-scheme`) par défaut ; bascule clair / sombre / système mémorisée dans le navigateur (`localStorage`, clé `gs-theme`), appliquée avant le premier rendu (pas de flash) et synchronisée entre onglets. Le mode sombre est choisi rôle par rôle (pas une inversion) ; contrastes AA des deux thèmes vérifiés par test. |
| D43 | Domaines de production | `admin.<domaine>` (SPA statique) et `api.<domaine>` : **même site**, donc cookies `SameSite=Strict` envoyés ; domaine choisi au déploiement. Conséquences : `CORS_ALLOWED_ORIGINS=https://admin.<domaine>` (credentials), `VITE_API_BASE_URL=https://api.<domaine>`. Le cookie `gs_csrf` est posé par l'API pour son hôte et n'est pas lisible depuis `admin.` : le client lit le cookie quand il est accessible (dev, même origine via le proxy Vite), sinon garde en **mémoire** le jeton reçu au login et au refresh, et après un rechargement de page le redemande à `GET /auth/csrf` (session identifiée par le cookie d'accès, ou de refresh sans rotation ; une seule requête à la fois). Le jeton n'est jamais écrit dans le stockage du navigateur : seul un indicateur non secret « session ouverte » (`gs-signed-in`) l'est, pour distinguer une session expirée d'une première visite. |
| D44 | Langue (admin web) | **Français uniquement en V1**, textes centralisés (`Web/src/i18n/fr.ts`, typé `Messages` ; messages d'erreur par code stable dans `errors.ts`) : une traduction ajoutera un dictionnaire du même type sans toucher aux composants. Dates et nombres en `fr-FR`, fuseau `Africa/Porto-Novo` pour les stats. |
| D45 | Socle de l'admin web | Vite 8 + React 19 (React Compiler), TypeScript strict, Tailwind 4 (palette par défaut désactivée : tokens seulement), shadcn/ui (Radix) + blocs 21st.dev harmonisés, TanStack Router (routes fichiers, découpage automatique) / Query / Table, react-hook-form + zod/mini, types générés depuis `openapi.yaml` (`npm run gen:api`, openapi-typescript + openapi-fetch). Session : cookies de l'API, jeton CSRF sur toute écriture, **refresh single-flight** (une promesse par onglet + verrou Web Locks entre onglets, horodatage partagé du dernier refresh : une requête partie avant un refresh abouti est rejouée sans en refaire un), session expirée → `/login?redirect=…&reason=expired`. Budget : JS initial < 200 Ko gzip (`npm run check:bundle`), Lighthouse desktop ≥ 95 et mobile ≥ 85 visé (performance), accessibilité 100, animations en transform et opacité. Dev : Vite 5173 avec proxy `/api` (même origine) ; E2E Playwright sur le build servi par `vite preview` (4173), admin créé par la CLI (mot de passe sur stdin). |
| D46 | E2E isolés | Les E2E Playwright tournent sur une pile dédiée créée par `scripts/e2e-stack.sh` : base `gostation_e2e` sur le même serveur PostGIS (créée, migrée, remplie par `cmd/seed` et `cmd/e2efixtures`, supprimée à la fin), Redis base 15 vidée, API sur 127.0.0.1:8095, justificatifs dans `var/e2e/`. `cmd/e2efixtures` refuse la production et toute base dont le nom ne finit pas par `_e2e` ; il crée les dossiers des scénarios par les services Go (aucune route de test). Une seule connexion admin partagée (projet `setup`, storageState) : la connexion admin est limitée à 5 par minute et par IP. Plus aucun compte de test dans la base de dev. Côté Go, chaque test d'intégration est indépendant et rejouable (`-count=10`) : emails uniques, Redis vidé par test, base dédiée clonée d'un gabarit migré pour les tests de schéma. |
| D47 | Écrans d'administration | Filtres, curseur, onglet et élément ouvert (`?report=`, `?user=`, `?station=`) dans l'URL (lien profond, retour arrière) ; pagination par curseur (pile des curseurs en mémoire) ; listes en TanStack Table v9, détails en panneau latéral, fiche station en page. Écritures sur une station avec `If-Match` = version lue au moment d'agir ; sur 412, la fiche est rechargée et le dialogue garde la saisie ; la correction montre les champs changés entre-temps (à l'ouverture / maintenant / votre saisie) et recharge en conservant les champs modifiés par l'admin. Mise à jour optimiste seulement pour l'ordre du catalogue (annulée si l'API refuse). Badges de la barre latérale par `GET /admin/counters` toutes les 60 s ; les alertes ajoutent les épingles à vérifier (`needsReview`) aux types de l'API. |
| D48 | Visionneuse de justificatif | Le justificatif est lu par l'endpoint admin audité, gardé en mémoire (Blob retypé d'après une liste blanche : PDF, PNG, JPEG ; jamais le type servi tel quel), affiché par une URL objet révoquée à la fermeture et jamais mis en cache (requête sans cache, `gcTime` 0). PDF rendu en canvas par pdf.js (chargé à la demande, XFA désactivé : aucun script du document exécuté), zoom 50 à 300 %, pagination, téléchargement. |
| D49 | App mobile unique | Une seule app pour les utilisateurs et les gérants ; la navigation dépend du rôle (`GET /me`). L'espace gérant arrive à l'étape 9B. Identifiant `bj.gostation.app` (Android et iOS) ; Android d'abord, le code reste compatible iOS (testé plus tard). Dev build Expo (pas Expo Go), New Architecture, Hermes, TypeScript strict ; `android/` et `ios/` générés par `expo prebuild`, jamais commités. |
| D50 | Cible et budgets mobiles | Android d'entrée et de milieu de gamme (2 à 3 Go de RAM), data mobile chère. 60 fps sur les listes, la carte et les animations (Reanimated sur le thread UI, transform et opacité seulement) ; démarrage à froid < 2,5 s sur un milieu de gamme ; requêtes et tuiles minimisées : cache ambiant MapLibre de 80 Mo, caméra limitée au Bénin et ses abords, style sans sprite ni relief raster, réponses gzip, pas de rechargement au retour de focus, catalogue et fiches persistés. |
| D51 | Position dans l'app | Règle 2 appliquée au client : la position (appareil ou point choisi sur la carte) vit en mémoire (store Zustand non persisté), n'entre jamais dans une clé de requête, MMKV, les préférences ni les URL de navigation. Résultats de recherche et itinéraires (qui en dépendent) : mémoire seulement (recherche par store, itinéraire par mutation) ; hors connexion, les derniers résultats de la session restent affichés. Seules les requêtes `['public', …]` (catalogue, fiches) sont persistées dans MMKV (test de régression `src/test/privacy.test.ts`). Signalement : position lue juste avant l'envoi, dans le corps de la requête uniquement. |
| D52 | Stockage et session mobiles | Refresh token dans expo-secure-store (Keystore), access token en mémoire ; refresh single-flight (une promesse partagée, rejeu des 401 envoyées avant le dernier refresh sans nouvel appel). `X-Install-Id` : UUID tiré au premier lancement (MMKV). Préférences non sensibles (accueil vu, dernier produit, guidage vocal) et cache public dans MMKV. Client typé `openapi-fetch` généré depuis la spec, réponses validées par zod/mini (`satisfies` sur les types générés). |
| D53 | Design system mobile | Tokens générés depuis `Web/src/styles/globals.css` (`npm run gen:tokens`, oklch → hex), exposés en variables NativeWind par thème (clair ou sombre selon le système) et en hex via `useTheme()` pour la carte et les icônes. Typographie Geist embarquée (une famille par graisse), corps 16 dp, cibles tactiles ≥ 48 dp, élévations natives, haptique parcimonieuse. Carte : style OpenFreeMap Positron recoloré aux tokens (`npm run gen:map-styles`), marqueurs en couches natives regroupées. Documentation : `Mobile/docs/design-system.md` ; vitrine `/design` en dev. |
| D54 | Guidage | Étapes de l'API traduites sur l'appareil (osrm-text-instructions, `fr`), direction du départ calculée sur le tracé. Suivi par `watchPositionAsync` (précision navigation, 1 s / 3 m) ; recalcul au-delà de 50 m d'écart sur 2 mesures précises (≤ 40 m), au plus toutes les 20 s ; arrivée à 30 m. Annonces vocales facultatives (expo-speech) à 800, 200 et 40 m, une seule par seuil ; écran maintenu allumé pendant le guidage seulement. `/routes` en 503 ou réseau absent : ligne droite en pointillés et « Ouvrir dans une autre app » (intent `geo:` ou Apple Plans). |
| D55 | Dev sur téléphone | L'API est jointe depuis le téléphone par `adb reverse tcp:8080 tcp:8080` (Metro : 8081) ; son URL est `EXPO_PUBLIC_API_URL` (`Mobile/.env`, `http://127.0.0.1:8080` par défaut). |
| D56 | Correctifs Reanimated | `react-native-reanimated` 4.5.5 et `react-native-worklets` 0.10.4 au lieu des 4.5.1 / 0.10.1 de l'SDK 57 (exclus de `expo install --check`) : les correctifs 4.5.3 et 4.5.4 corrigent des crashs natifs du proxy d'animations de mise en page (délégué de montage Fabric), observés au rechargement du JS en dev build. À réaligner sur la version de l'SDK dès qu'elle les inclut. |
| D57 | Unités mobiles | 1 rem = 16 dp (`inlineRem` de NativeWind, 14 par défaut) : les classes Tailwind valent sur mobile ce qu'elles valent sur le web et les tailles du design system (cibles de 48 dp, marges de 20 dp) sont respectées. Polices et rayons restent en px. Un test fige le réglage ; l'audit `npm run a11y` mesure les cibles. |

### Questions ouvertes

1. **Réseaux de stations** : un gérant peut-il gérer plusieurs stations, et plusieurs stations peuvent-elles partager un même IFU ? (Le modèle actuel suppose un gérant = une station et ne rend pas l'IFU unique.)
2. **Délais légaux** : délai de réponse aux demandes APDP et durées de conservation (§8), à confirmer.
3. **Prix** des carburants et du gaz : hors périmètre V1 ?
