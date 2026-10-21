#!/usr/bin/env bash
# Crée .env.production (ou le fichier donné) depuis .env.production.example : chaque marqueur
# change-me-* reçoit un secret aléatoire neuf (openssl), le fichier est créé en 600 et n'écrase
# jamais un fichier existant (rotation d'un secret : docs/DEPLOY.md). Restent les « fill-me »
# (domaine, SMTP, Expo…), listés à la fin, à remplir à la main. Aucune valeur n'est affichée.
#
#   scripts/gen-prod-secrets.sh [fichier]          crée le fichier
#   scripts/gen-prod-secrets.sh --sync [fichier]   y ajoute les variables apparues dans le modèle
#                                                  depuis (secrets générés), sans rien modifier d'autre
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

EXAMPLE="$ROOT_DIR/.env.production.example"
SYNC=0
if [[ "${1:-}" == --sync ]]; then
  SYNC=1
  shift
fi
OUT="${1:-$ROOT_DIR/.env.production}"
command -v openssl > /dev/null || die "openssl requis"

secret() {
  case "$1" in
    # Mots de passe insérés dans des URL (postgres://, redis://) : hexadécimal, sans caractère à échapper.
    change-me-postgres | change-me-redis | change-me-glitchtip-db) openssl rand -hex 24 ;;
    # Graine Ed25519 avec son identifiant de clé (kid) : « kAAAAMMJJ:hex ».
    change-me-jwt-signing-keys) printf 'k%s:%s' "$(date +%Y%m%d)" "$(openssl rand -hex 32)" ;;
    # Identifiant de clé S3 (20 caractères, comme chez AWS) ; mot de passe du compte GlitchTip.
    change-me-s3-access-key) openssl rand -hex 10 ;;
    change-me-glitchtip-admin) openssl rand -hex 16 ;;
    *) openssl rand -hex 32 ;;
  esac
}

fill() {
  local line="$1" marker
  while [[ "$line" =~ (change-me-[a-z0-9-]+) ]]; do
    marker="${BASH_REMATCH[1]}"
    line="${line//"$marker"/$(secret "$marker")}"
  done
  printf '%s\n' "$line"
}

umask 077
if [[ "$SYNC" == 1 ]]; then
  [[ -f "$OUT" ]] || die "$OUT absent : le créer d'abord (sans --sync)"
  added=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)= ]] || continue
    key="${BASH_REMATCH[1]}"
    grep -q "^${key}=" "$OUT" && continue
    [[ ${#added[@]} -eq 0 ]] && printf '\n# Ajouté par gen-prod-secrets.sh --sync le %s\n' "$(date -u +%F)" >> "$OUT"
    fill "$line" >> "$OUT"
    added+=("$key")
  done < "$EXAMPLE"
  if [[ ${#added[@]} -gt 0 ]]; then ok "ajouté à $OUT : ${added[*]}"; else ok "$OUT déjà à jour"; fi
else
  [[ -e "$OUT" ]] && die "$OUT existe déjà : rien n'est écrasé (--sync pour y ajouter les nouvelles variables)"
  tmp="$(mktemp "$OUT.XXXXXX")"
  trap 'rm -f "$tmp"' ERR
  while IFS= read -r line || [[ -n "$line" ]]; do
    fill "$line"
  done < "$EXAMPLE" > "$tmp"
  mv "$tmp" "$OUT"
  chmod 600 "$OUT"
  ok "$OUT créé (600), secrets générés"
fi
todo="$(grep -n 'fill-me' "$OUT" | grep -v '^[0-9]*:#' | cut -d= -f1 | sed 's/^[0-9]*://' | sort -u | tr '\n' ' ')"
[[ -n "$todo" ]] && warn "à remplir : $todo"
[[ "$SYNC" == 1 ]] || warn "copier DOCUMENTS_ENCRYPTION_KEY et RESTIC_PASSWORD dans un coffre de mots de passe hors du serveur"
