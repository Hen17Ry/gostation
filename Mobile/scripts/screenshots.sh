#!/usr/bin/env bash
# Captures de référence de chaque écran (docs/screenshots/), en clair puis en sombre, sur l'appareil
# branché (téléphone de préférence). Contre la pile API isolée (comptes jetables, cf. e2e.sh).
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p docs/screenshots
ROOT="$(cd .. && pwd)"
ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
MAESTRO="${MAESTRO:-$HOME/.maestro/bin/maestro}"
# shellcheck source=device.sh
source scripts/device.sh
device_save
# Captures de référence en police normale (celle du téléphone est rétablie à la fin).
"$ADB" shell settings put system font_scale 1.0

ready() { curl -fsS -o /dev/null http://127.0.0.1:8095/readyz 2> /dev/null; }
stack=""
if [[ "${SPLASH_ONLY:-0}" != 1 ]] && ! ready; then
  "$ROOT/scripts/e2e-stack.sh" up > "$ROOT/var/e2e/mobile-stack.log" 2>&1 &
  stack=$!
  for _ in $(seq 1 180); do ready && break; sleep 1; done
fi
cleanup() {
  device_restore
  "$ADB" reverse tcp:8080 tcp:8080 > /dev/null 2>&1 || true
  if [[ -n "$stack" && "${E2E_KEEP:-0}" != 1 ]]; then
    kill "$stack" 2> /dev/null || true
    pkill -f "$ROOT/var/e2e/bin/" 2> /dev/null || true
    "$ROOT/scripts/e2e-stack.sh" down > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

# Écran de démarrage : lancement à froid filmé, image retenue = celle où le fond du splash couvre le
# plus l'écran tout en montrant l'icône (orange). Le splash ne dure que quelques centaines de ms :
# trois essais, et un échec ne bloque pas les autres captures.
splash() {
  local theme=$1
  for attempt in 1 2 3; do
    splash_once "$theme" && return 0
    echo "  · écran de démarrage ($theme) non capté, essai $attempt/3"
  done
  echo "✗ écran de démarrage ($theme) : garder la capture précédente"
}
splash_once() {
  local theme=$1 work status=0
  work="$(mktemp -d)"
  "$ADB" shell am force-stop bj.gostation.app
  "$ADB" shell screenrecord --time-limit 4 /sdcard/splash.mp4 &
  local rec=$!
  sleep 1.5
  "$ADB" shell am start -n bj.gostation.app/.MainActivity > /dev/null
  wait "$rec" || true
  "$ADB" pull -q /sdcard/splash.mp4 "$work/splash.mp4"
  mkdir -p "$work/frames"
  ffmpeg -loglevel error -y -i "$work/splash.mp4" -vf fps=30 "$work/frames/%03d.png"
  python3 - "$work/frames" "docs/screenshots/00-splash-$theme.png" "$theme" <<'PY' || status=$?
import shutil, sys
from pathlib import Path
from PIL import Image
bg = (251, 250, 249) if sys.argv[3] == 'light' else (11, 10, 9)
def score(path):
    px = list(Image.open(path).convert('RGB').resize((108, 240)).get_flattened_data())
    plain = sum(1 for p in px if all(abs(a - b) < 6 for a, b in zip(p, bg)))
    icon = sum(1 for r, g, b in px if r > 180 and 70 < g < 170 and b < 110)
    return plain if icon > 20 else 0
frames = sorted(Path(sys.argv[1]).glob('*.png'))
best = max(frames, key=score)
if score(best) == 0:
    sys.exit('splash introuvable dans l’enregistrement')
shutil.copy(best, sys.argv[2])
PY
  rm -rf "$work"
  return "$status"
}

"$ADB" reverse tcp:8080 tcp:8095 > /dev/null
demo_on
if [[ "${SPLASH_ONLY:-0}" == 1 ]]; then
  for theme in ${THEMES:-light dark}; do
    "$ADB" shell cmd uimode night "$([[ $theme == dark ]] && echo yes || echo no)" > /dev/null
    sleep 2
    splash "$theme"
  done
  echo "✔ écran de démarrage capturé"
  exit 0
fi
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
  splash "$theme"
done
echo "✔ $(find docs/screenshots -name '*.png' | wc -l) captures dans docs/screenshots/"
