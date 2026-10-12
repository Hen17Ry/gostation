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
for scenario in ${SCENARIOS:-search-scroll navigation}; do
  echo "▶ $scenario"
  "$FLASHLIGHT" test --bundleId bj.gostation.app --testCommand "maestro test .maestro/perf/$scenario.yaml" \
    --duration 25000 --iterationCount "${ITERATIONS:-3}" --resultsFilePath "$OUT/$scenario.json" --resultsTitle "$scenario"
done
