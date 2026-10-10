# Fonctions communes aux scripts GoStation. À sourcer : . "$(dirname "$0")/_lib.sh"
# shellcheck shell=bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

log()  { printf '\033[1;33m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✖\033[0m %s\n' "$*" >&2; exit 1; }

# Lit une clé de .env sans exécuter le fichier. Priorité : environnement > .env > défaut.
env_get() {
  local key="$1" default="${2:-}" val=""
  if [[ -n "${!key:-}" ]]; then printf '%s' "${!key}"; return; fi
  if [[ -f "$ENV_FILE" ]]; then
    val="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
    val="${val%\"}"; val="${val#\"}"
  fi
  printf '%s' "${val:-$default}"
}

compose() { docker compose --project-directory "$ROOT_DIR" -f "$ROOT_DIR/docker-compose.yml" "$@"; }

require_env_file() { [[ -f "$ENV_FILE" ]] || die ".env absent — lance d'abord : make env"; }
