#!/usr/bin/env bash
# Pile E2E de l'admin web, isolée de la base de développement.
#
#   e2e-stack.sh up    recrée la base gostation_e2e (migrée), vide la base Redis 15, génère des
#                      données de démo (stations, stats) et les fixtures des scénarios
#                      (var/e2e/fixtures.json), puis lance le pilotage des parcours mobiles
#                      (e2efixtures serve, 127.0.0.1:8097), le worker et l'API sur 127.0.0.1:8095
#                      (au premier plan : Playwright l'arrête à la fin des tests) ;
#   e2e-stack.sh down  supprime la base gostation_e2e, vide la base Redis 15 et les justificatifs.
#
# Utilise PostGIS et Redis du compose (make up) et Mailpit pour les emails. Lancé par
# Web/playwright.config.ts (webServer et globalTeardown).
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_env_file
cd "$ROOT_DIR"

E2E_DB=gostation_e2e
E2E_REDIS_DB=15
E2E_DIR="$ROOT_DIR/var/e2e"
E2E_API_ADDR=127.0.0.1:8095
E2E_WORKER_ADDR=127.0.0.1:8096
E2E_CONTROL_ADDR=127.0.0.1:8097

pg_user="$(env_get POSTGRES_USER)"
base_db_url="$(env_get DATABASE_URL)"
base_redis_url="$(env_get REDIS_URL)"
# Même serveur que la base de dev, autre base ; même Redis, autre numéro de base.
db_url="$(printf '%s' "$base_db_url" | sed -E "s#/[^/?]+(\\?|$)#/${E2E_DB}\\1#")"
redis_url="$(printf '%s' "$base_redis_url" | sed -E "s#/[0-9]+\$##")/${E2E_REDIS_DB}"

psql_admin() { compose exec -T postgres psql -q -U "$pg_user" -d postgres -v ON_ERROR_STOP=1 "$@"; }
flush_redis() { compose exec -T redis redis-cli -n "$E2E_REDIS_DB" FLUSHDB > /dev/null; }

down() {
  psql_admin -c "DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)"
  flush_redis
  rm -rf "$E2E_DIR/documents"
  ok "pile E2E nettoyée (base ${E2E_DB} supprimée)"
}

up() {
  mkdir -p "$E2E_DIR/bin"
  log "compilation (api, worker, admin, seed, e2efixtures)"
  (cd Backend && for c in api worker admin seed e2efixtures; do go build -o "$E2E_DIR/bin/$c" "./cmd/$c"; done)

  log "base ${E2E_DB} : recréation et migrations"
  psql_admin -c "DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)" -c "CREATE DATABASE ${E2E_DB}"
  GOOSE_DRIVER=postgres GOOSE_DBSTRING="$db_url" GOOSE_MIGRATION_DIR=Backend/db/migrations \
    "${GOOSE:-$(go env GOPATH)/bin/goose}" up > /dev/null
  flush_redis
  rm -rf "$E2E_DIR/documents" && mkdir -p "$E2E_DIR/documents"

  # Surcharges de la configuration (le reste vient de .env via with-env.sh, sans écrasement).
  export DATABASE_URL="$db_url" REDIS_URL="$redis_url" HTTP_ADDR="$E2E_API_ADDR" \
    WORKER_HEALTH_ADDR="$E2E_WORKER_ADDR" DOCUMENTS_STORAGE_DIR="$E2E_DIR/documents" \
    CORS_ALLOWED_ORIGINS="http://127.0.0.1:4173" LOG_LEVEL="${E2E_LOG_LEVEL:-warn}"
  # Les tests en ont besoin pour créer leurs admins avec la CLI sur la même base.
  printf '{"DATABASE_URL":"%s","REDIS_URL":"%s","DOCUMENTS_STORAGE_DIR":"%s"}\n' \
    "$db_url" "$redis_url" "$E2E_DIR/documents" > "$E2E_DIR/env.json"
  chmod 600 "$E2E_DIR/env.json"

  log "données de démo et fixtures"
  scripts/with-env.sh "$E2E_DIR/bin/seed" -count 1500 -stats-days 14 > "$E2E_DIR/seed.log" 2>&1
  scripts/with-env.sh "$E2E_DIR/bin/e2efixtures" > "$E2E_DIR/fixtures.json"

  log "pilotage des parcours mobiles sur ${E2E_CONTROL_ADDR}, worker et API sur ${E2E_API_ADDR}"
  scripts/with-env.sh "$E2E_DIR/bin/e2efixtures" serve -addr "$E2E_CONTROL_ADDR" > "$E2E_DIR/control.log" 2>&1 &
  control=$!
  scripts/with-env.sh "$E2E_DIR/bin/worker" > "$E2E_DIR/worker.log" 2>&1 &
  worker=$!
  trap 'kill "$worker" "$control" 2> /dev/null || true' EXIT INT TERM
  scripts/with-env.sh "$E2E_DIR/bin/api" > "$E2E_DIR/api.log" 2>&1
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) die "usage : $0 up|down" ;;
esac
