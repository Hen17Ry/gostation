#!/usr/bin/env bash
# Mesures Flashlight (FPS, CPU, RAM) sur l'appareil branché, build release installé et API de dev
# joignable (adb reverse tcp:8080 tcp:8080). Résultats JSON dans var/perf/ ; rapport web :
# ~/.flashlight/bin/flashlight report var/perf/<scénario>.json
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
OUT="$(cd .. && pwd)/var/perf"
mkdir -p "$OUT"
FLASHLIGHT="${FLASHLIGHT:-$HOME/.flashlight/bin/flashlight}"
export PATH="$PATH:$HOME/.maestro/bin:${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools"
# Mesure sur toute la durée du scénario : une fenêtre fixe (25 s) ne couvrait pas les balayages sur
# le téléphone, où Maestro est plus lent que sur l'émulateur. DURATION=<ms> en impose une.
window=()
[[ -n "${DURATION:-}" ]] && window=(--duration "$DURATION")
# shellcheck disable=SC2206 # liste de scénarios séparés par des espaces
scenarios=(${SCENARIOS:-search-scroll navigation})

# Scénarios du gérant (manager-*) : pile E2E isolée (jamais de compte de test dans la base de dev),
# station prête créée par le pilotage (e2efixtures serve) et gérant connecté avant les mesures.
if [[ " ${scenarios[*]} " == *" manager-"* ]]; then
  ROOT="$(cd .. && pwd)"
  ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
  ready() { curl -fsS -o /dev/null http://127.0.0.1:8095/readyz 2> /dev/null && curl -fsS -o /dev/null http://127.0.0.1:8097/healthz 2> /dev/null; }
  stack=""
  if ! ready; then
    "$ROOT/scripts/e2e-stack.sh" up > "$ROOT/var/e2e/mobile-stack.log" 2>&1 &
    stack=$!
    for _ in $(seq 1 240); do ready && break; sleep 1; done
  fi
  restore() {
    "$ADB" reverse tcp:8080 tcp:8080 > /dev/null 2>&1 || true
    if [[ -n "$stack" && "${E2E_KEEP:-0}" != 1 ]]; then
      kill "$stack" 2> /dev/null || true
      pkill -f "$ROOT/var/e2e/bin/" 2> /dev/null || true
      "$ROOT/scripts/e2e-stack.sh" down > /dev/null 2>&1 || true
    fi
  }
  trap restore EXIT INT TERM
  "$ADB" reverse tcp:8080 tcp:8095 > /dev/null
  manager=$(curl -fsS -X POST http://127.0.0.1:8097/managers/operational -d '{"name":"Station Mesure Flashlight"}')
  email=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["email"])' <<< "$manager")
  password=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' <<< "$manager")
  maestro test .maestro/common/manager-sign-in.yaml -e EMAIL="$email" -e PASSWORD="$password" > "$OUT/manager-sign-in.log" 2>&1
fi
for scenario in "${scenarios[@]}"; do
  echo "▶ $scenario"
  "$FLASHLIGHT" test --bundleId bj.gostation.app --testCommand "maestro test .maestro/perf/$scenario.yaml" \
    "${window[@]}" --iterationCount "${ITERATIONS:-3}" --resultsFilePath "$OUT/$scenario.json" --resultsTitle "$scenario"
done
results=()
for scenario in "${scenarios[@]}"; do results+=("$OUT/$scenario.json"); done
python3 scripts/perf-summary.py "${results[@]}"
