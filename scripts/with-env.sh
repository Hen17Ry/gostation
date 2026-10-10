#!/usr/bin/env bash
# Exécute une commande avec les variables de .env, SANS écraser celles déjà définies dans
# l'environnement : « SEARCH_RATE_LIMIT_IP=1000000 scripts/with-env.sh go run ./cmd/api » garde
# la valeur passée. Le fichier est interprété comme par « . .env » (guillemets compris).
# Usage : scripts/with-env.sh <commande> [arguments…]
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

require_env_file
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  key="${line%%=*}"
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
  if [[ -z "${!key+x}" ]]; then
    eval "export $line"
  fi
done < "$ENV_FILE"
exec "$@"
