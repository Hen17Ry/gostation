#!/usr/bin/env bash
# Autorise la copie des sauvegardes vers Google Drive (docs/DEPLOY.md §10), sur le poste
# d'exploitation qui a un navigateur : rclone ouvre la page de consentement de Google, puis écrit
# le jeton dans un fichier rclone.conf local (600, gitignoré), que scripts/prod.sh
# backup-remote-setup installe sur le serveur. Le jeton n'est jamais affiché.
#
# Accès « drive.file » : rclone ne voit que les fichiers créés avec ce client OAuth
# (gostation-backups/…), jamais le reste du Drive. Changer de client rend donc invisibles les
# fichiers créés par l'ancien (renommer l'ancien dossier avant, docs/DEPLOY.md §10).
#
# Client OAuth personnel (celui de rclone est retiré par Google en 2026) : GDRIVE_CLIENT_ID et
# GDRIVE_CLIENT_SECRET dans deploy/gdrive-client.env (600, gitignoré, rempli à la main), lu s'il
# existe ; sinon le client partagé de rclone.
#
#   scripts/gdrive-authorize.sh [fichier]     défaut : deploy/staging.rclone.conf
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

OUT="${1:-$ROOT_DIR/deploy/staging.rclone.conf}"
command -v rclone > /dev/null || die "rclone introuvable : https://rclone.org/install/ (un binaire dans ~/.local/bin suffit)"
[[ -e "$OUT" ]] && die "$OUT existe déjà (le supprimer pour refaire l'autorisation)"

umask 077
args=(scope=drive.file)
CLIENT_ENV="$ROOT_DIR/deploy/gdrive-client.env"
if [[ -f "$CLIENT_ENV" ]]; then
  [[ "$(stat -c '%a' "$CLIENT_ENV")" == 600 ]] || die "$CLIENT_ENV doit être en 600"
  id="$(grep -E '^GDRIVE_CLIENT_ID=' "$CLIENT_ENV" | tail -n1 | cut -d= -f2-)"
  secret="$(grep -E '^GDRIVE_CLIENT_SECRET=' "$CLIENT_ENV" | tail -n1 | cut -d= -f2-)"
  [[ -n "$id" && -n "$secret" ]] || die "GDRIVE_CLIENT_ID et GDRIVE_CLIENT_SECRET à remplir dans $CLIENT_ENV"
  args+=("client_id=$id" "client_secret=$secret")
  log "client OAuth personnel ($CLIENT_ENV)"
else
  warn "client OAuth partagé de rclone, retiré par Google en 2026 : créer $CLIENT_ENV (docs/DEPLOY.md §10)"
fi
log "ouverture du navigateur : choisir le compte Google, puis « Autoriser »"
# La sortie standard reprend la configuration créée, jeton compris : jamais affichée.
rclone config create gdrive drive "${args[@]}" --config "$OUT" > /dev/null
rclone mkdir gdrive:gostation-backups --config "$OUT"
rclone lsd gdrive: --config "$OUT" | grep -q gostation-backups || die "dossier gostation-backups introuvable sur le Drive"
ok "autorisation enregistrée dans $OUT (dossier gostation-backups créé sur le Drive)"
