#!/usr/bin/env bash
# Autorise la copie des sauvegardes vers Google Drive (docs/DEPLOY.md §10), sur le poste
# d'exploitation qui a un navigateur : rclone ouvre la page de consentement de Google, puis écrit
# le jeton dans un fichier rclone.conf local (600, gitignoré), que scripts/prod.sh
# backup-remote-setup installe sur le serveur. Le jeton n'est jamais affiché.
#
# Accès « drive.file » : rclone ne voit que les fichiers qu'il a créés (gostation-backups/…),
# jamais le reste du Drive.
#
#   scripts/gdrive-authorize.sh [fichier]     défaut : deploy/staging.rclone.conf
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

OUT="${1:-$ROOT_DIR/deploy/staging.rclone.conf}"
command -v rclone > /dev/null || die "rclone introuvable : https://rclone.org/install/ (un binaire dans ~/.local/bin suffit)"
[[ -e "$OUT" ]] && die "$OUT existe déjà (le supprimer pour refaire l'autorisation)"

umask 077
log "ouverture du navigateur : choisir le compte Google, puis « Autoriser »"
# La sortie standard reprend la configuration créée, jeton compris : jamais affichée.
rclone config create gdrive drive scope=drive.file --config "$OUT" > /dev/null
rclone mkdir gdrive:gostation-backups --config "$OUT"
rclone lsd gdrive: --config "$OUT" | grep -q gostation-backups || die "dossier gostation-backups introuvable sur le Drive"
ok "autorisation enregistrée dans $OUT (dossier gostation-backups créé sur le Drive)"
