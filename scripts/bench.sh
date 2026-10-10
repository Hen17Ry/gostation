#!/usr/bin/env bash
# Bench de la recherche (make bench) : lance une API dédiée (port BENCH_PORT, quotas levés, logs
# en warn) sur la base de dev seedée, vide le cache de recherche puis exécute k6 (Docker) depuis
# cinq zones. Résultats JSON complets dans bench/results/.
# Variables : DURATION (60s), RATE (100 req/s), BENCH_PORT (18080).
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

require_env_file
K6_IMAGE="grafana/k6:1.3.0"
PORT="${BENCH_PORT:-18080}"
DURATION="${DURATION:-60s}"
RATE="${RATE:-100}"
RESULTS_DIR="$ROOT_DIR/bench/results"
mkdir -p "$RESULTS_DIR"

psql_dev() { compose exec -T postgres sh -c "psql -X -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \"$1\""; }

for svc in postgres redis osrm; do
  cid="$(compose ps -q "$svc")"
  [[ -n "$cid" ]] || die "$svc absent : make up"
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$cid")" == "healthy" ]] || die "$svc pas healthy : make up"
done
demo="$(psql_dev "SELECT count(*) FROM stations WHERE is_demo")"
if (( demo < 5000 )); then
  log "Stations fictives : $demo — génération (make seed-dev)"
  make -C "$ROOT_DIR" --no-print-directory seed-dev
fi
products="$(psql_dev "SELECT string_agg(id::text, ',' ORDER BY sort_order) FROM products WHERE is_active AND code IN ('lpg_5kg','lpg_10kg','lpg_25kg','petrol','diesel')")"

log "Compilation de l'API"
(cd "$ROOT_DIR/Backend" && go build -trimpath -o bin/api-bench ./cmd/api)

api_log="$RESULTS_DIR/api-bench.log"
log "Démarrage de l'API de bench sur 127.0.0.1:$PORT (logs : ${api_log#"$ROOT_DIR"/})"
HTTP_ADDR="127.0.0.1:$PORT" LOG_LEVEL=warn APP_ENV=development \
  RATE_LIMIT_IP_REQUESTS=1000000 SEARCH_RATE_LIMIT_IP=10000000 SEARCH_RATE_LIMIT_CLIENT=10000000 \
  "$ROOT_DIR/scripts/with-env.sh" "$ROOT_DIR/Backend/bin/api-bench" > "$api_log" 2>&1 &
api_pid=$!
trap 'kill "$api_pid" 2> /dev/null || true; wait "$api_pid" 2> /dev/null || true' EXIT
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/readyz" > /dev/null 2>&1 && break
  kill -0 "$api_pid" 2> /dev/null || die "l'API s'est arrêtée : voir $api_log"
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$PORT/readyz" > /dev/null || die "API pas prête : voir $api_log"

# Départ à froid : nouvelle génération globale du cache de recherche.
compose exec -T redis redis-cli INCR search:gen:all > /dev/null

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
log "k6 : $RATE req/s pendant $DURATION (produits $products)"
set +e
docker run --rm --network host -u "$(id -u):$(id -g)" \
  -v "$ROOT_DIR/scripts/bench:/scripts:ro" -v "$RESULTS_DIR:/results" \
  -e BASE_URL="http://127.0.0.1:$PORT" -e PRODUCT_IDS="$products" -e RATE="$RATE" -e DURATION="$DURATION" \
  -e RESULTS="/results/search-$stamp.json" \
  "$K6_IMAGE" run --quiet --no-color /scripts/search.js
status=$?
set -e
ok "Résultats complets : bench/results/search-$stamp.json"
exit "$status"
