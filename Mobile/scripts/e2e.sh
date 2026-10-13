#!/usr/bin/env bash
# Parcours E2E Maestro de l'app mobile contre la pile API isolée (base gostation_e2e, API 8095, et
# pilotage des parcours gérant e2efixtures serve sur 8097),
# jamais contre la base de développement. Le téléphone (ou l'émulateur) joint l'API par
# adb reverse : son 127.0.0.1:8080 pointe vers l'API E2E le temps des tests, puis vers l'API de dev.
#
#   npm run e2e                 lance la pile, installe rien, exécute .maestro/ puis nettoie
#   E2E_KEEP=1 npm run e2e      garde la pile E2E (relance plus rapide)
#   MAESTRO_ARGS="--include-tags=…" pour filtrer
#
# Prérequis : make up (PostGIS, Redis, Mailpit), build release de l'app installé
# (npm run build:apk && adb install -r …), Maestro dans ~/.maestro/bin.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(cd .. && pwd)"
ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
MAESTRO="${MAESTRO:-$HOME/.maestro/bin/maestro}"
LOG="$ROOT/var/e2e/mobile-stack.log"
mkdir -p "$ROOT/var/e2e"

ready() { curl -fsS -o /dev/null http://127.0.0.1:8095/readyz 2> /dev/null; }

stack=""
if ! ready; then
  echo "▶ pile E2E (API 127.0.0.1:8095)"
  "$ROOT/scripts/e2e-stack.sh" up > "$LOG" 2>&1 &
  stack=$!
  for _ in $(seq 1 180); do ready && break; sleep 1; done
  ready || { echo "✗ l'API E2E ne répond pas (voir $LOG)"; exit 1; }
fi

# Justificatif de test des parcours gérant : déposé dans Téléchargements (choisi dans le sélecteur
# de fichiers du système), retiré à la fin.
TEST_DOC=/sdcard/Download/gostation-justificatif-e2e.pdf
media_scan() { "$ADB" shell content call --method scan_volume --uri content://media --arg external_primary > /dev/null 2>&1 || true; }

cleanup() {
  "$ADB" shell rm -f "$TEST_DOC" > /dev/null 2>&1 || true
  media_scan
  "$ADB" reverse tcp:8080 tcp:8080 > /dev/null 2>&1 || true
  if [[ -n "$stack" && "${E2E_KEEP:-0}" != 1 ]]; then
    kill "$stack" 2> /dev/null || true
    pkill -f "$ROOT/var/e2e/bin/" 2> /dev/null || true
    "$ROOT/scripts/e2e-stack.sh" down > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

"$ADB" reverse tcp:8080 tcp:8095 > /dev/null
"$ADB" push .maestro/assets/gostation-justificatif-e2e.pdf "$TEST_DOC" > /dev/null
media_scan
echo "▶ Maestro (.maestro/)"
# shellcheck disable=SC2086
"$MAESTRO" test .maestro ${MAESTRO_ARGS:-} --format junit --output "$ROOT/var/e2e/mobile-junit.xml"
