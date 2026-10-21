# Prélude des scripts d'exploitation du serveur (prod.sh, backup.sh, restore.sh). À sourcer :
# . "$(dirname "${BASH_SOURCE[0]}")/_prod.sh"
#
# Fichier d'environnement : GOSTATION_ENV_FILE, sinon .env.production à la racine du dépôt.
# Fichiers compose : docker-compose.prod.yml, plus GOSTATION_EXTRA_COMPOSE (liste séparée par « : »,
# chemins relatifs au dépôt), lu dans l'environnement ou à défaut dans le fichier d'environnement
# (staging : deploy/staging.compose.yml ; répétition locale : deploy/rehearsal.compose.yml).
# shellcheck shell=bash

PROD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export GOSTATION_ENV_FILE="${GOSTATION_ENV_FILE:-$PROD_ROOT/.env.production}"
if [[ -z "${GOSTATION_EXTRA_COMPOSE:-}" && -f "$GOSTATION_ENV_FILE" ]]; then
  GOSTATION_EXTRA_COMPOSE="$(grep -E '^GOSTATION_EXTRA_COMPOSE=' "$GOSTATION_ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
fi
GOSTATION_COMPOSE_FILE="$PROD_ROOT/docker-compose.prod.yml"
if [[ -n "${GOSTATION_EXTRA_COMPOSE:-}" ]]; then
  IFS=: read -ra _extra <<< "$GOSTATION_EXTRA_COMPOSE"
  for _f in "${_extra[@]}"; do
    [[ "$_f" == /* ]] || _f="$PROD_ROOT/$_f"
    GOSTATION_COMPOSE_FILE+=":$_f"
  done
  unset _extra _f
fi
export GOSTATION_COMPOSE_FILE

# shellcheck source=scripts/_lib.sh
. "$PROD_ROOT/scripts/_lib.sh"

# Nom du projet compose (préfixe des volumes et des réseaux : gostation-prod_storage…).
compose_project() {
  compose config --format json 2> /dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])' || echo gostation-prod
}
