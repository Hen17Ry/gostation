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
#   scripts/prod.sh glitchtip-setup       compte (GLITCHTIP_ADMIN_*), organisation, projets api, admin
#                                         et mobile ; affiche leurs DSN (KEY=valeur)
#   scripts/prod.sh errtrack-test         un événement de test de l'API et un du worker vers GlitchTip
#   scripts/prod.sh backup | restore SNAPSHOT [--yes] | snapshots     voir scripts/backup.sh, restore.sh
#   scripts/prod.sh backup-remote-setup   installe le rclone.conf lu sur l'entrée standard (copie
#                                         hors du serveur, scripts/gdrive-authorize.sh)
#   scripts/prod.sh versions              versions construites (pour rollback)
# Staging seulement (deploy/staging.compose.yml) :
#   scripts/prod.sh seed [options]        stations fictives et stats de démo (cmd/seed)
#   scripts/prod.sh e2e-fixtures          données des E2E de l'admin (JSON sur la sortie)
#   scripts/prod.sh e2e-control up|down   pilotage des parcours Maestro (127.0.0.1:8097 du serveur)
#   scripts/prod.sh e2e-cleanup           supprime les comptes de test et leurs données, vide Mailpit
set -Eeuo pipefail

# shellcheck source=scripts/_prod.sh
. "$(dirname "${BASH_SOURCE[0]}")/_prod.sh"
ROOT="$PROD_ROOT"

release() { git -C "$ROOT" describe --tags --always --dirty 2> /dev/null || date +%Y%m%d%H%M; }

check() {
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE absent : scripts/gen-prod-secrets.sh"
  local mode
  mode="$(stat -c '%a' "$ENV_FILE")"
  [[ "$mode" == 600 || "$mode" == 400 ]] || die "$ENV_FILE en $mode : chmod 600 $ENV_FILE"
  local todo
  todo="$(grep -nE '(fill-me|change-me)' "$ENV_FILE" | grep -v '^[0-9]*:#' | cut -d= -f1 | sed 's/^[0-9]*://' | sort -u | tr '\n' ' ' || true)"
  [[ -z "$todo" ]] || die "à remplir dans $ENV_FILE : $todo"
  # Champs laissés vides à remplir à la main (secret collé par l'exploitant).
  local empty
  empty="$(grep -B1 -E '^[A-Z_]+=$' "$ENV_FILE" | grep -A1 'À REMPLIR' | grep -oE '^[A-Z_]+(=)' | tr -d = | tr '\n' ' ' || true)"
  [[ -z "$empty" ]] || die "à remplir dans $ENV_FILE : $empty"
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

staging_only() {
  [[ "$(env_get APP_ENV)" == staging ]] || die "commande réservée au staging (APP_ENV=staging)"
  [[ "$GOSTATION_COMPOSE_FILE" == *staging.compose.yml* ]] || die "GOSTATION_EXTRA_COMPOSE=deploy/staging.compose.yml requis"
}

# Image des outils du staging (seed, e2efixtures), construite à la demande pour la version courante.
tools() {
  staging_only
  local v
  v="$(release)"
  docker image inspect "gostation-tools:$v" > /dev/null 2>&1 || RELEASE="$v" compose --profile tools build tools
  RELEASE="$v" compose --profile tools run --rm --no-deps -T tools "$@"
}

e2e_control() {
  staging_only
  local v
  v="$(release)"
  case "${1:-}" in
    up)
      docker image inspect "gostation-tools:$v" > /dev/null 2>&1 || RELEASE="$v" compose --profile tools build tools
      RELEASE="$v" compose --profile e2e up -d --wait e2e-control
      ok "pilotage des E2E sur 127.0.0.1:8097 du serveur (tunnel : make staging-tunnel)"
      ;;
    down) compose --profile e2e rm -sf e2e-control ;;
    *) die "usage : scripts/prod.sh e2e-control up|down" ;;
  esac
}

e2e_cleanup() {
  staging_only
  tools /app/e2efixtures cleanup
  # Emails des adresses de test gardés par Mailpit (API sur la boucle locale du serveur).
  if curl -fsS -o /dev/null -X DELETE 'http://127.0.0.1:8025/api/v1/messages'; then
    ok "Mailpit vidé"
  else
    warn "Mailpit non vidé (arrêté ?)"
  fi
}

errtrack_test() {
  [[ -n "$(env_get SENTRY_DSN)" ]] || die "SENTRY_DSN vide : scripts/prod.sh glitchtip-setup, puis redéployer"
  compose run --rm --no-deps -T api errtrack-test
  compose run --rm --no-deps -T --entrypoint /app/worker worker errtrack-test
}

backup_remote_setup() {
  local work="${BACKUP_WORK_DIR:-/var/lib/gostation-backup}"
  [[ -t 0 ]] && die "usage : scripts/prod.sh backup-remote-setup < rclone.conf (jamais collé au clavier)"
  umask 077
  mkdir -p "$work/rclone"
  cat > "$work/rclone/rclone.conf.new"
  grep -q '^\[' "$work/rclone/rclone.conf.new" || { rm -f "$work/rclone/rclone.conf.new"; die "rclone.conf vide ou invalide"; }
  mv "$work/rclone/rclone.conf.new" "$work/rclone/rclone.conf"
  ok "rclone.conf installé ($work/rclone, 600)"
  "$ROOT/scripts/backup.sh" remote
}

rollback() {
  local v="${1:-}"
  [[ -n "$v" ]] || die "usage : scripts/prod.sh rollback VERSION (scripts/prod.sh versions)"
  docker image inspect "gostation-api:$v" "gostation-proxy:$v" > /dev/null 2>&1 || die "images de la version $v absentes"
  warn "les migrations ne sont pas annulées : une version antérieure doit rester compatible avec le schéma (docs/DEPLOY.md)"
  RELEASE="$v" compose up -d --no-build --wait api worker caddy
  printf '%s\n' "$v" >> "$ROOT/var/releases"
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
  glitchtip-setup)
    GLITCHTIP_ADMIN_EMAIL="$(env_get GLITCHTIP_ADMIN_EMAIL)" GLITCHTIP_ADMIN_PASSWORD="$(env_get GLITCHTIP_ADMIN_PASSWORD)" \
      compose exec -T -e GLITCHTIP_ADMIN_EMAIL -e GLITCHTIP_ADMIN_PASSWORD glitchtip ./manage.py shell < "$ROOT/deploy/glitchtip-setup.py"
    ;;
  errtrack-test) errtrack_test ;;
  backup-remote-setup) backup_remote_setup ;;
  seed) tools /app/seed "$@" ;;
  e2e-fixtures) tools /app/e2efixtures ;;
  e2e-control) e2e_control "$@" ;;
  e2e-cleanup) e2e_cleanup ;;
  backup) "$ROOT/scripts/backup.sh" ;;
  restore) "$ROOT/scripts/restore.sh" "$@" ;;
  snapshots) "$ROOT/scripts/backup.sh" snapshots ;;
  *) sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
