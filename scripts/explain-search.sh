#!/usr/bin/env bash
# Affiche les plans réels (EXPLAIN ANALYZE) des requêtes de recherche sur la base de dev et
# vérifie que l'index GiST des stations est utilisé. Prérequis : make up, make seed-dev.
# Usage : scripts/explain-search.sh   (ou make explain-search)
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

require_env_file
plan="$(compose exec -T postgres sh -c 'psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -' < "$ROOT_DIR/scripts/sql/explain-search.sql")"
printf '%s\n' "$plan"
count="$(grep -c 'idx_stations_location_approved' <<< "$plan" || true)"
[[ "$count" -ge 2 ]] || die "index GiST idx_stations_location_approved absent d'au moins un plan"
ok "Index GiST utilisé par les deux requêtes ($count occurrences)."
