#!/usr/bin/env bash
# Crée .env.production (ou le fichier donné) depuis .env.production.example : chaque marqueur
# change-me-* reçoit un secret aléatoire neuf (openssl), le fichier est créé en 600 et n'écrase
# jamais un fichier existant (rotation d'un secret : docs/DEPLOY.md). Restent les « fill-me »
# (domaine, SMTP, S3, Expo…), listés à la fin, à remplir à la main.
#
#   scripts/gen-prod-secrets.sh [fichier]
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

EXAMPLE="$ROOT_DIR/.env.production.example"
OUT="${1:-$ROOT_DIR/.env.production}"
[[ -e "$OUT" ]] && die "$OUT existe déjà : rien n'est écrasé"
command -v openssl > /dev/null || die "openssl requis"

secret() {
  case "$1" in
    # Mots de passe insérés dans des URL (postgres://, redis://) : hexadécimal, sans caractère à échapper.
    change-me-postgres | change-me-redis | change-me-glitchtip-db) openssl rand -hex 24 ;;
    # Graine Ed25519 avec son identifiant de clé (kid) : « kAAAAMMJJ:hex ».
    change-me-jwt-signing-keys) printf 'k%s:%s' "$(date +%Y%m%d)" "$(openssl rand -hex 32)" ;;
    *) openssl rand -hex 32 ;;
  esac
}

umask 077
tmp="$(mktemp "$OUT.XXXXXX")"
trap 'rm -f "$tmp"' ERR
while IFS= read -r line || [[ -n "$line" ]]; do
  while [[ "$line" =~ (change-me-[a-z0-9-]+) ]]; do
    marker="${BASH_REMATCH[1]}"
    line="${line//"$marker"/$(secret "$marker")}"
  done
  printf '%s\n' "$line"
done < "$EXAMPLE" > "$tmp"
mv "$tmp" "$OUT"
chmod 600 "$OUT"

ok "$OUT créé (600), secrets générés"
todo="$(grep -n 'fill-me' "$OUT" | grep -v '^[0-9]*:#' | cut -d= -f1 | sed 's/^[0-9]*://' | sort -u | tr '\n' ' ')"
[[ -n "$todo" ]] && warn "à remplir : $todo"
warn "copier DOCUMENTS_ENCRYPTION_KEY et RESTIC_PASSWORD dans un coffre de mots de passe hors du serveur"
