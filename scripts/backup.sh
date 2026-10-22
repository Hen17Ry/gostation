#!/usr/bin/env bash
# Sauvegarde quotidienne de la production (cron, docs/DEPLOY.md), chiffrée par restic (AES-256)
# dans RESTIC_REPOSITORY (dépôt local du serveur, ou S3), puis copiée hors du serveur
# (BACKUP_RCLONE_REMOTE, par exemple Google Drive) :
#   - la base GoStation (pg_dump, format custom) ;
#   - les fichiers chiffrés (justificatifs, exports, copies) : volume local, ou miroir incrémental
#     du bucket S3 (rclone) si STORAGE_DRIVER=s3 ;
#   - .env.production : sans lui (DOCUMENTS_ENCRYPTION_KEY…), les fichiers sont illisibles.
# Puis rotation : BACKUP_KEEP_DAILY / WEEKLY / MONTHLY (7 / 4 / 3), vérification du dépôt et copie
# du dépôt local vers BACKUP_RCLONE_REMOTE (rclone sync : le dépôt est déjà chiffré ; sur Google
# Drive, un fichier retiré par la rotation passe d'abord 30 jours dans la corbeille).
# Ne sont pas sauvegardés : Redis (sessions, files d'attente, quotas, cache : tout se reconstruit,
# une restauration déconnecte simplement tous les comptes), GlitchTip (rapports de 30 jours) et les
# certificats (réémis par Caddy). restic et rclone tournent dans des conteneurs aux versions figées.
#
#   scripts/backup.sh               sauvegarde + rotation + vérification + copie hors du serveur
#   scripts/backup.sh snapshots     liste les sauvegardes
#   scripts/backup.sh remote        contenu et taille de la copie hors du serveur
#   scripts/backup.sh pull          rapatrie la copie dans le dépôt local (nouveau serveur, §11)
set -Eeuo pipefail

# shellcheck source=scripts/_prod.sh
. "$(dirname "${BASH_SOURCE[0]}")/_prod.sh"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE absent"

RESTIC_IMAGE="${RESTIC_IMAGE:-restic/restic:0.19.1}"
RCLONE_IMAGE="${RCLONE_IMAGE:-rclone/rclone:1.75.2}"
PROJECT="$(compose_project)"
NETWORK="${PROJECT}_net"
# Répertoire de travail sur l'hôte (dump, miroir du bucket, rclone.conf) : jamais lisible par
# d'autres comptes.
WORK="${BACKUP_WORK_DIR:-/var/lib/gostation-backup}"
REPO="$(env_get RESTIC_REPOSITORY)"
# Dépôt local (chemin absolu) : monté au même chemin dans les conteneurs restic et rclone.
repo_mount=()
[[ "$REPO" == /* ]] && repo_mount=(-v "$REPO:$REPO")

# restic dans un conteneur, sur le réseau de la pile (dépôt local, S3 externe, ou S3 de la
# répétition).
restic() {
  docker run --rm -i --network "$NETWORK" "${repo_mount[@]}" \
    -e RESTIC_REPOSITORY="$(env_get RESTIC_REPOSITORY)" -e RESTIC_PASSWORD="$(env_get RESTIC_PASSWORD)" \
    -e AWS_ACCESS_KEY_ID="$(env_get BACKUP_S3_ACCESS_KEY_ID)" -e AWS_SECRET_ACCESS_KEY="$(env_get BACKUP_S3_SECRET_ACCESS_KEY)" \
    -e AWS_DEFAULT_REGION="$(env_get BACKUP_S3_REGION us-east-1)" -e RESTIC_HOST=gostation-prod \
    -v "$WORK:/backup/work:ro" \
    -v "${PROJECT}_documents:/backup/documents:ro" -v "$ENV_FILE:/backup/env/.env.production:ro" \
    -v "$WORK/restore:/restore" \
    "$RESTIC_IMAGE" "$@"
}

init_repo() {
  [[ "$REPO" == /* ]] && mkdir -p "$REPO"
  restic cat config > /dev/null 2>&1 && return
  log "dépôt restic absent : initialisation"
  restic init
}

# rclone dans un conteneur, avec le rclone.conf de WORK (jeton rafraîchi et réécrit par rclone).
rclone_remote() {
  [[ -s "$WORK/rclone/rclone.conf" ]] || die "$WORK/rclone/rclone.conf absent : scripts/prod.sh backup-remote-setup"
  docker run --rm "${repo_mount[@]}" -v "$WORK/rclone:/config/rclone" "$RCLONE_IMAGE" "$@"
}

offsite() {
  local remote
  remote="$(env_get BACKUP_RCLONE_REMOTE)"
  [[ -n "$remote" ]] || { warn "BACKUP_RCLONE_REMOTE vide : aucune copie hors du serveur"; return; }
  [[ "$REPO" == /* ]] || die "BACKUP_RCLONE_REMOTE ne copie qu'un dépôt local (RESTIC_REPOSITORY=/chemin)"
  log "copie du dépôt vers $remote"
  rclone_remote sync "$REPO" "$remote" --fast-list --transfers 4 --stats-one-line --stats 0
  ok "copie hors du serveur à jour"
}

dump_postgres() {
  log "dump de la base $(env_get POSTGRES_DB)"
  compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner' > "$WORK/gostation.dump.part"
  mv "$WORK/gostation.dump.part" "$WORK/gostation.dump"
  [[ -s "$WORK/gostation.dump" ]] || die "dump vide"
}

mirror_documents() {
  [[ "$(env_get STORAGE_DRIVER local)" == s3 ]] || { rm -rf "$WORK/documents"; return; }
  log "miroir du bucket $(env_get S3_BUCKET)/$(env_get S3_PREFIX)"
  local scheme=https
  [[ "$(env_get S3_TLS true)" == true ]] || scheme=http
  mkdir -p "$WORK/documents"
  docker run --rm --network "${PROJECT}_storage" --user "$(id -u):$(id -g)" \
    -e RCLONE_S3_PROVIDER=Other -e RCLONE_S3_ENDPOINT="$scheme://$(env_get S3_ENDPOINT)" \
    -e RCLONE_S3_REGION="$(env_get S3_REGION us-east-1)" \
    -e RCLONE_S3_ACCESS_KEY_ID="$(env_get S3_ACCESS_KEY_ID)" -e RCLONE_S3_SECRET_ACCESS_KEY="$(env_get S3_SECRET_ACCESS_KEY)" \
    -e RCLONE_S3_FORCE_PATH_STYLE="$(env_get S3_PATH_STYLE false)" \
    -v "$WORK/documents:/mirror" "$RCLONE_IMAGE" \
    sync ":s3:$(env_get S3_BUCKET)/$(env_get S3_PREFIX)" /mirror --fast-list --checksum
}

backup() {
  umask 077
  mkdir -p "$WORK"
  chmod 700 "$WORK"
  init_repo
  dump_postgres
  mirror_documents
  local paths=(/backup/work/gostation.dump /backup/env/.env.production)
  if [[ "$(env_get STORAGE_DRIVER local)" == s3 ]]; then paths+=(/backup/work/documents); else paths+=(/backup/documents); fi
  log "sauvegarde restic"
  restic backup --tag gostation --tag "$(env_get APP_ENV production)" "${paths[@]}"
  rm -f "$WORK/gostation.dump"
  log "rotation : $(env_get BACKUP_KEEP_DAILY 7) j, $(env_get BACKUP_KEEP_WEEKLY 4) sem., $(env_get BACKUP_KEEP_MONTHLY 3) mois"
  restic forget --tag gostation --prune \
    --keep-daily "$(env_get BACKUP_KEEP_DAILY 7)" --keep-weekly "$(env_get BACKUP_KEEP_WEEKLY 4)" \
    --keep-monthly "$(env_get BACKUP_KEEP_MONTHLY 3)"
  # Lecture d'un échantillon des données (1/7 par jour : tout le dépôt chaque semaine).
  restic check --read-data-subset "$(( $(date +%u) ))/7"
  ok "sauvegarde terminée"
  offsite
}

case "${1:-}" in
  "") backup ;;
  snapshots) restic snapshots --tag gostation ;;
  remote) rclone_remote size "$(env_get BACKUP_RCLONE_REMOTE)" ;;
  pull)
    [[ "$REPO" == /* ]] || die "pull ne remplit qu'un dépôt local (RESTIC_REPOSITORY=/chemin)"
    mkdir -p "$REPO"
    rclone_remote sync "$(env_get BACKUP_RCLONE_REMOTE)" "$REPO" --fast-list --transfers 4
    ok "dépôt local rempli depuis $(env_get BACKUP_RCLONE_REMOTE)"
    ;;
  restic) shift; restic "$@" ;;
  *) die "usage : scripts/backup.sh [snapshots | remote | pull]" ;;
esac
