#!/usr/bin/env bash
# Affiche les plans réels (EXPLAIN ANALYZE) des requêtes de stats admin sur la base de dev et
# vérifie que les périodes de 7 et 30 jours ne lisent jamais search_stats en entier (agrégats).
# Prérequis : make up, make migrate-up, make seed-dev.
# Usage : scripts/explain-stats.sh   (ou make explain-stats)
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

require_env_file
plan="$(compose exec -T postgres sh -c 'psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -' < "$ROOT_DIR/scripts/sql/explain-stats.sql")"
printf '%s\n' "$plan"
if grep -qE 'Seq Scan on search_stats( |$)' <<< "$plan"; then
  die "parcours complet de search_stats : une période longue ne passe pas par les agrégats"
fi
grep -q 'pk_search_stats' <<< "$plan" || die "la période de 24 h n'utilise pas l'index primaire de search_stats"
ok "Périodes longues servies par les agrégats, période de 24 h par l'index primaire de search_stats."
