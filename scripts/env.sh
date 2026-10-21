#!/usr/bin/env bash
# Gère le fichier .env à partir de .env.example :
#   init  crée .env avec des secrets aléatoires (refuse d'écraser un .env existant)
#   sync  ajoute à .env les variables apparues dans .env.example, sans toucher aux existantes
# Les marqueurs change-me-* sont remplacés par la valeur déjà présente dans .env (cohérence
# entre POSTGRES_PASSWORD et DATABASE_URL, par exemple), sinon par un secret neuf.
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

EXAMPLE="$ROOT_DIR/.env.example"
command -v openssl > /dev/null || die "openssl requis"

# Valeur d'une clé dans .env uniquement (l'environnement du shell est ignoré).
dotenv_get() {
  [[ -f "$ENV_FILE" ]] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true
}

# Marqueur → variable de .env qui en porte déjà la valeur, et générateur de secours.
declare -A SOURCE=(
  [change-me-postgres]=POSTGRES_PASSWORD
  [change-me-redis]=REDIS_PASSWORD
  [change-me-documents-key]=DOCUMENTS_ENCRYPTION_KEY
  [change-me-app-secret]=APP_SECRET
  [change-me-rate-limit-key]=RATE_LIMIT_KEY
  [change-me-jwt-signing-keys]=JWT_SIGNING_KEYS
)
declare -A VALUE=()
resolve() {
  local marker
  for marker in "${!SOURCE[@]}"; do
    local current
    current="$(dotenv_get "${SOURCE[$marker]}")"
    if [[ -n "$current" && "$current" != change-me-* ]]; then
      VALUE[$marker]="$current"
      continue
    fi
    case "$marker" in
      change-me-postgres | change-me-redis) VALUE[$marker]="$(openssl rand -hex 24)" ;;
      change-me-jwt-signing-keys) VALUE[$marker]="k$(date +%Y%m%d):$(openssl rand -hex 32)" ;;
      *) VALUE[$marker]="$(openssl rand -hex 32)" ;;
    esac
  done
}

substitute() {
  local line="$1" marker
  for marker in "${!VALUE[@]}"; do
    line="${line//$marker/${VALUE[$marker]}}"
  done
  printf '%s\n' "$line"
}

case "${1:-}" in
  init)
    [[ -f "$ENV_FILE" ]] && die ".env existe déjà (make env-sync pour ajouter les nouvelles variables)"
    resolve
    umask 077
    while IFS= read -r line || [[ -n "$line" ]]; do substitute "$line"; done < "$EXAMPLE" > "$ENV_FILE"
    ok ".env créé avec des secrets aléatoires"
    ;;
  sync)
    require_env_file
    resolve
    added=()
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" =~ ^([A-Z][A-Z0-9_]*)= ]] || continue
      key="${BASH_REMATCH[1]}"
      grep -qE "^${key}=" "$ENV_FILE" && continue
      [[ ${#added[@]} -eq 0 ]] && printf '\n# ── Ajouté par make env-sync le %s\n' "$(date +%F)" >> "$ENV_FILE"
      substitute "$line" >> "$ENV_FILE"
      added+=("$key")
    done < "$EXAMPLE"
    if [[ ${#added[@]} -eq 0 ]]; then ok ".env déjà à jour"; else ok "Ajouté à .env : ${added[*]}"; fi
    ;;
  *) die "usage : scripts/env.sh init|sync" ;;
esac
