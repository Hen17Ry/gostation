#!/usr/bin/env bash
# Restauration d'une sauvegarde restic (scripts/backup.sh). Runbook : docs/DEPLOY.md.
#
#   scripts/restore.sh env SNAPSHOT            extrait .env.production d'une sauvegarde (nouveau
#                                              serveur : écrit .env.production.restored)
#   scripts/restore.sh SNAPSHOT [--yes]        remplace la base et les fichiers par ceux de la
#                                              sauvegarde (SNAPSHOT : identifiant ou « latest »)
#
# Étapes : arrêt de l'API et du worker ; base recréée puis pg_restore ; fichiers remis en place
# (volume local, ou bucket S3 synchronisé : les objets absents de la sauvegarde sont supprimés) ;
# Redis vidé (sessions et files : tout le monde se reconnecte) ; migrations ; redémarrage ;
# contrôle (/readyz, comptes et stations). Sans --yes, une confirmation est demandée.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export GOSTATION_ENV_FILE="${GOSTATION_ENV_FILE:-$ROOT/.env.production}"
export GOSTATION_COMPOSE_FILE="$ROOT/docker-compose.prod.yml${GOSTATION_EXTRA_COMPOSE:+:$GOSTATION_EXTRA_COMPOSE}"
# shellcheck source=scripts/_lib.sh
. "$ROOT/scripts/_lib.sh"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE absent (nouveau serveur : RESTIC_* et BACKUP_S3_* suffisent pour « env »)"

WORK="${BACKUP_WORK_DIR:-/var/lib/gostation-backup}"
RCLONE_IMAGE="${RCLONE_IMAGE:-rclone/rclone:1.75.2}"
PROJECT="$(compose config --format json 2> /dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])' || echo gostation-prod)"
restic() { "$ROOT/scripts/backup.sh" restic "$@"; }

fetch() {
  local snap="$1"
  umask 077
  mkdir -p "$WORK"
  docker run --rm -v "$WORK:/work" alpine:3.22 rm -rf /work/restore
  mkdir -p "$WORK/restore"
  log "lecture de la sauvegarde $snap"
  restic restore "$snap" --target /restore
}

env_only() {
  local snap="${1:-latest}"
  fetch "$snap"
  local out="$ROOT/.env.production.restored"
  docker run --rm -v "$WORK/restore:/r:ro" alpine:3.22 cat /r/backup/env/.env.production > "$out"
  chmod 600 "$out"
  ok "$out écrit : le relire, puis le renommer en .env.production"
}

restore() {
  local snap="${1:-}" yes="${2:-}"
  [[ -n "$snap" ]] || die "usage : scripts/restore.sh SNAPSHOT [--yes]"
  if [[ "$yes" != --yes ]]; then
    warn "la base $(env_get POSTGRES_DB) et les fichiers vont être REMPLACÉS par la sauvegarde $snap"
    read -r -p "Taper « restaurer » pour continuer : " answer
    [[ "$answer" == restaurer ]] || die "abandon"
  fi
  fetch "$snap"
  docker run --rm -v "$WORK/restore:/r:ro" alpine:3.22 test -s /r/backup/work/gostation.dump || die "pas de dump dans $snap"

  log "arrêt de l'API et du worker"
  compose stop api worker
  compose up -d --wait postgres redis

  local db user
  db="$(env_get POSTGRES_DB)"
  user="$(env_get POSTGRES_USER)"
  log "base $db recréée depuis la sauvegarde"
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$user" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" -c "CREATE DATABASE \"$db\" OWNER \"$user\"" \
    -c "REVOKE CONNECT ON DATABASE \"$db\" FROM PUBLIC"
  docker run --rm -v "$WORK/restore:/r:ro" alpine:3.22 cat /r/backup/work/gostation.dump |
    compose exec -T postgres pg_restore -U "$user" -d "$db" --no-owner --exit-on-error

  if [[ "$(env_get STORAGE_DRIVER local)" == s3 ]]; then
    log "fichiers : bucket $(env_get S3_BUCKET)/$(env_get S3_PREFIX) synchronisé sur la sauvegarde"
    local scheme=https
    [[ "$(env_get S3_TLS true)" == true ]] || scheme=http
    docker run --rm --network "${PROJECT}_net" \
      -e RCLONE_S3_PROVIDER=Other -e RCLONE_S3_ENDPOINT="$scheme://$(env_get S3_ENDPOINT)" \
      -e RCLONE_S3_REGION="$(env_get S3_REGION us-east-1)" \
      -e RCLONE_S3_ACCESS_KEY_ID="$(env_get S3_ACCESS_KEY_ID)" -e RCLONE_S3_SECRET_ACCESS_KEY="$(env_get S3_SECRET_ACCESS_KEY)" \
      -e RCLONE_S3_FORCE_PATH_STYLE="$(env_get S3_PATH_STYLE false)" \
      -v "$WORK/restore/backup/work/documents:/from:ro" "$RCLONE_IMAGE" \
      sync /from ":s3:$(env_get S3_BUCKET)/$(env_get S3_PREFIX)" --checksum
  else
    log "fichiers : volume ${PROJECT}_documents remplacé"
    docker run --rm -v "${PROJECT}_documents:/docs" -v "$WORK/restore/backup/documents:/from:ro" alpine:3.22 \
      sh -c 'find /docs -mindepth 1 -delete && cp -a /from/. /docs/ && chown -R 65532:65532 /docs'
  fi

  log "Redis vidé (sessions, files, cache : tout le monde se reconnecte)"
  compose exec -T redis redis-cli FLUSHALL > /dev/null

  log "migrations (sauvegarde plus ancienne que le code)"
  compose run --rm --no-deps -T api migrate
  compose up -d --wait api worker caddy
  docker run --rm -v "$WORK:/work" alpine:3.22 rm -rf /work/restore

  local counts
  counts="$(compose exec -T postgres psql -U "$user" -d "$db" -tAc \
    "SELECT (SELECT count(*) FROM users) || ' comptes, ' || (SELECT count(*) FROM stations) || ' stations'")"
  ok "restauration de $snap terminée : $counts"
}

case "${1:-}" in
  env) shift; env_only "$@" ;;
  "" | -h | --help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
  *) restore "$@" ;;
esac
