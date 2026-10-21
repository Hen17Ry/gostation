#!/usr/bin/env bash
# Exploitation de la production (ou du staging) : docker-compose.prod.yml et .env.production, sur
# le serveur, depuis la racine du dépôt. Runbook pas à pas : docs/DEPLOY.md.
#
#   scripts/prod.sh check                 .env.production complet (600, sans fill-me ni change-me), compose valide
#   scripts/prod.sh osrm-prepare          télécharge l'extrait Bénin et prépare OSRM (FORCE=1 pour retraiter)
#   scripts/prod.sh deploy                build des images (version = git describe), migrations, démarrage, attente healthy
#   scripts/prod.sh migrate [status]      migrations dans un conteneur jetable (la base n'est jamais exposée)
#   scripts/prod.sh rollback VERSION      api, worker et proxy sur les images d'une version déjà construite
#   scripts/prod.sh ps | logs [service] | down
#   scripts/prod.sh admin-create EMAIL PRÉNOM NOM    compte admin (mot de passe saisi au clavier)
#   scripts/prod.sh admin-reset-2fa EMAIL
#   scripts/prod.sh glitchtip-superuser   premier compte GlitchTip (interactif)
#   scripts/prod.sh backup | restore SNAPSHOT [--yes] | snapshots     voir scripts/backup.sh, restore.sh
#   scripts/prod.sh versions              versions construites (pour rollback)
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export GOSTATION_ENV_FILE="${GOSTATION_ENV_FILE:-$ROOT/.env.production}"
export GOSTATION_COMPOSE_FILE="$ROOT/docker-compose.prod.yml${GOSTATION_EXTRA_COMPOSE:+:$GOSTATION_EXTRA_COMPOSE}"
# shellcheck source=scripts/_lib.sh
. "$ROOT/scripts/_lib.sh"

release() { git -C "$ROOT" describe --tags --always --dirty 2> /dev/null || date +%Y%m%d%H%M; }

check() {
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE absent : scripts/gen-prod-secrets.sh"
  local mode
  mode="$(stat -c '%a' "$ENV_FILE")"
  [[ "$mode" == 600 || "$mode" == 400 ]] || die "$ENV_FILE en $mode : chmod 600 $ENV_FILE"
  local todo
  todo="$(grep -nE '(fill-me|change-me)' "$ENV_FILE" | grep -v '^[0-9]*:#' | cut -d= -f1 | sed 's/^[0-9]*://' | sort -u | tr '\n' ' ' || true)"
  [[ -z "$todo" ]] || die "à remplir dans $ENV_FILE : $todo"
  [[ "$(env_get APP_ENV)" =~ ^(production|staging)$ ]] || die "APP_ENV doit valoir production ou staging"
  compose config --quiet || die "docker-compose.prod.yml invalide avec $ENV_FILE"
  ok "configuration complète ($(env_get DOMAIN), $(env_get APP_ENV))"
}

migrate() {
  # Conteneur jetable sur le réseau interne : mêmes variables que l'API.
  compose run --rm --no-deps -T api migrate "$@"
}

deploy() {
  check
  local v
  v="$(release)"
  log "version $v : images tierces à jour"
  compose pull --quiet postgres redis osrm glitchtip
  log "build des images gostation-api:$v et gostation-proxy:$v"
  RELEASE="$v" compose build --pull
  log "démarrage de la base et de Redis"
  RELEASE="$v" compose up -d --wait postgres redis
  log "migrations"
  RELEASE="$v" migrate
  log "démarrage de tous les services"
  RELEASE="$v" compose up -d --wait --wait-timeout 300 --remove-orphans
  printf '%s\n' "$v" >> "$ROOT/var/releases"
  ok "version $v déployée"
  compose ps
}

rollback() {
  local v="${1:-}"
  [[ -n "$v" ]] || die "usage : scripts/prod.sh rollback VERSION (scripts/prod.sh versions)"
  docker image inspect "gostation-api:$v" "gostation-proxy:$v" > /dev/null 2>&1 || die "images de la version $v absentes"
  warn "les migrations ne sont pas annulées : une version antérieure doit rester compatible avec le schéma (docs/DEPLOY.md)"
  RELEASE="$v" compose up -d --no-build --wait api worker caddy
  ok "api, worker et proxy en version $v"
}

mkdir -p "$ROOT/var"
cmd="${1:-}"
shift || true
case "$cmd" in
  check) check ;;
  osrm-prepare) "$ROOT/scripts/osrm-prepare.sh" ${FORCE:+--force} ;;
  deploy | up) deploy ;;
  migrate) migrate "$@" ;;
  rollback) rollback "$@" ;;
  versions) docker image ls gostation-api --format '{{.Tag}}\t{{.CreatedSince}}' ;;
  ps) compose ps ;;
  logs) compose logs -f --tail=200 "$@" ;;
  down) compose down ;;
  admin-create)
    [[ $# -eq 3 ]] || die "usage : scripts/prod.sh admin-create EMAIL PRÉNOM NOM"
    compose run --rm --no-deps --entrypoint /app/admin api create --email "$1" --first-name "$2" --last-name "$3"
    ;;
  admin-reset-2fa)
    [[ $# -eq 1 ]] || die "usage : scripts/prod.sh admin-reset-2fa EMAIL"
    compose run --rm --no-deps --entrypoint /app/admin api reset-2fa --email "$1"
    ;;
  glitchtip-superuser) compose exec glitchtip ./manage.py createsuperuser ;;
  backup) "$ROOT/scripts/backup.sh" ;;
  restore) "$ROOT/scripts/restore.sh" "$@" ;;
  snapshots) "$ROOT/scripts/backup.sh" snapshots ;;
  *) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
