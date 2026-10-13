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
for scenario in "${scenarios[@]}"; do
  echo "▶ $scenario"
  "$FLASHLIGHT" test --bundleId bj.gostation.app --testCommand "maestro test .maestro/perf/$scenario.yaml" \
    "${window[@]}" --iterationCount "${ITERATIONS:-3}" --resultsFilePath "$OUT/$scenario.json" --resultsTitle "$scenario"
done
results=()
for scenario in "${scenarios[@]}"; do results+=("$OUT/$scenario.json"); done
python3 scripts/perf-summary.py "${results[@]}"
