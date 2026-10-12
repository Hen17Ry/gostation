#!/usr/bin/env bash
# Captures de référence de chaque écran (docs/screenshots/), en clair puis en sombre, sur l'appareil
# branché (téléphone de préférence). Contre la pile API isolée (comptes jetables, cf. e2e.sh).
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p docs/screenshots
ROOT="$(cd .. && pwd)"
ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
MAESTRO="${MAESTRO:-$HOME/.maestro/bin/maestro}"

ready() { curl -fsS -o /dev/null http://127.0.0.1:8095/readyz 2> /dev/null; }
stack=""
if ! ready; then
  "$ROOT/scripts/e2e-stack.sh" up > "$ROOT/var/e2e/mobile-stack.log" 2>&1 &
  stack=$!
  for _ in $(seq 1 180); do ready && break; sleep 1; done
fi
cleanup() {
  "$ADB" shell cmd uimode night no > /dev/null 2>&1 || true
  "$ADB" reverse tcp:8080 tcp:8080 > /dev/null 2>&1 || true
  if [[ -n "$stack" && "${E2E_KEEP:-0}" != 1 ]]; then
    kill "$stack" 2> /dev/null || true
    "$ROOT/scripts/e2e-stack.sh" down > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

"$ADB" reverse tcp:8080 tcp:8095 > /dev/null
for theme in ${THEMES:-light dark}; do
  "$ADB" shell cmd uimode night "$([[ $theme == dark ]] && echo yes || echo no)" > /dev/null
  sleep 2
  echo "▶ captures ($theme)"
  out="$(mktemp -d)"
  status=0
  "$MAESTRO" test .maestro/screenshots/capture.yaml -e THEME="$theme" --test-output-dir "$out" || status=$?
  # Maestro range les captures dans son dossier de sortie : on les recopie à plat.
  find "$out" -path '*takeScreenshot*' -name '*.png' -exec cp {} docs/screenshots/ \;
  rm -rf "$out"
  [[ $status == 0 ]] || { echo "✗ captures ($theme) incomplètes"; exit "$status"; }
done
echo "✔ $(find docs/screenshots -name '*.png' | wc -l) captures dans docs/screenshots/"
