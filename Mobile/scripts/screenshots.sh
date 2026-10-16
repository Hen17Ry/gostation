#!/usr/bin/env bash
# Captures de référence de chaque écran (docs/screenshots/), en clair puis en sombre, sur l'appareil
# branché (téléphone de préférence). Contre la pile API isolée (comptes jetables, cf. e2e.sh).
# PARTS : « main » (parcours principal, 01 à 26), « manager » (espace gérant, 50 à 70) ; les deux
# par défaut.
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
TEST_DOC=/sdcard/Download/gostation-justificatif-e2e.pdf
media_scan() { "$ADB" shell content call --method scan_volume --uri content://media --arg external_primary > /dev/null 2>&1 || true; }
cleanup() {
  "$ADB" shell rm -f "$TEST_DOC" > /dev/null 2>&1 || true
  media_scan
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
  # Téléphone : l'enregistrement d'écran ne capte pas l'écran de démarrage et retiendrait l'écran
  # d'accueil du téléphone (applications, fond d'écran personnels). Émulateur seulement.
  if [[ "$("$ADB" shell getprop ro.kernel.qemu | tr -d '\r')" != 1 ]]; then
    echo "  · écran de démarrage ($theme) : émulateur seulement, capture précédente gardée"
    return 0
  fi
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
# Gérant de la station exclue des fixtures : écran des signalements avec des effets en cours.
fixtures="$ROOT/var/e2e/fixtures.json"
reports_email=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["excluded"]["managerEmail"])' "$fixtures")
reports_password=$(python3 -c 'import json,sys; print("Lagune-" + json.load(open(sys.argv[1]))["run"] + "-Porto")' "$fixtures")
"$ADB" push .maestro/assets/gostation-justificatif-e2e.pdf "$TEST_DOC" > /dev/null
"$ADB" shell touch "$TEST_DOC" # en tête des « Fichiers récents » du sélecteur (voir e2e.sh)
media_scan

# capture <flux> <thème> [-e VAR=valeur…] : exécute un flux de captures et les recopie à plat.
capture() {
  local flow=$1 theme=$2 out status=0
  shift 2
  out="$(mktemp -d)"
  "$MAESTRO" test "$flow" -e THEME="$theme" "$@" --test-output-dir "$out" || status=$?
  # Maestro range les captures dans son dossier de sortie : on les recopie à plat.
  find "$out" -path '*takeScreenshot*' -name '*.png' -exec cp {} docs/screenshots/ \;
  rm -rf "$out"
  return "$status"
}
parts=" ${PARTS:-main manager} "
for theme in ${THEMES:-light dark}; do
  "$ADB" shell cmd uimode night "$([[ $theme == dark ]] && echo yes || echo no)" > /dev/null
  sleep 2
  if [[ $parts == *" main "* ]]; then
    echo "▶ captures du parcours principal ($theme)"
    capture .maestro/screenshots/capture.yaml "$theme" || { echo "✗ captures ($theme) incomplètes"; exit 1; }
    splash "$theme"
  fi
  if [[ $parts == *" manager "* ]]; then
    echo "▶ captures de l'espace gérant ($theme)"
    capture .maestro/screenshots/manager.yaml "$theme" -e REPORTS_EMAIL="$reports_email" -e REPORTS_PASSWORD="$reports_password" ||
      { echo "✗ captures du gérant ($theme) incomplètes"; exit 1; }
  fi
done
echo "✔ $(find docs/screenshots -name '*.png' | wc -l) captures dans docs/screenshots/"
