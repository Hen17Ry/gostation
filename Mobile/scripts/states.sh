#!/usr/bin/env bash
# États à mettre en scène sur la pile E2E isolée, vérifiés et capturés en clair et en sombre
# (docs/screenshots/) : aucune station, animation de rayon, station fermée et signalée, localisation
# refusée, hors connexion, alerte « de retour en stock » réelle (le gérant remet du gasoil), gestion
# du compte, guidage avec trajet GPS simulé (recalcul, arrivée, écran allumé, voix), puis OSRM coupé
# (distances estimées, 503 : ligne droite et autre app). Build release installé, émulateur Android.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(cd .. && pwd)"
ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
MAESTRO="${MAESTRO:-$HOME/.maestro/bin/maestro}"
# shellcheck source=device.sh
source scripts/device.sh
device_save
# Captures de référence en police normale (celle du téléphone est rétablie à la fin).
"$ADB" shell settings put system font_scale 1.0
SHOTS=docs/screenshots
WORK="$(mktemp -d)"
STACK=""
mkdir -p "$SHOTS" "$ROOT/var/e2e"

api_up() { curl -fsS -o /dev/null http://127.0.0.1:8095/api/v1/products 2> /dev/null; }
stack_up() {
  "$ROOT/scripts/e2e-stack.sh" up > "$ROOT/var/e2e/mobile-stack.log" 2>&1 &
  STACK=$!
  for _ in $(seq 1 300); do api_up && return 0; sleep 1; done
  echo "✗ API E2E injoignable (voir var/e2e/mobile-stack.log)"
  exit 1
}
stack_down() {
  [[ -n "$STACK" ]] && kill "$STACK" 2> /dev/null || true
  # L'API tourne au premier plan du script de pile : on arrête aussi ses binaires.
  pkill -f "$ROOT/var/e2e/bin/" 2> /dev/null || true
  sleep 1
  STACK=""
  "$ROOT/scripts/e2e-stack.sh" down > /dev/null 2>&1 || true
}
cleanup() {
  device_restore
  "$ADB" reverse tcp:8080 tcp:8080 > /dev/null 2>&1 || true
  stack_down
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM
demo_on

theme() {
  "$ADB" shell cmd uimode night "$([[ $1 == dark ]] && echo yes || echo no)" > /dev/null
  sleep 2
}
# run <flux> <thème> [-e VAR=valeur…] : exécute un flux et recopie ses captures.
run() {
  local flow=$1 t=$2 out status=0
  shift 2
  out="$(mktemp -d)"
  echo "  · $(basename "$flow" .yaml) ($t)"
  "$MAESTRO" test "$flow" -e THEME="$t" "$@" --test-output-dir "$out" > "$WORK/maestro.log" 2>&1 || status=$?
  find "$out" -path '*takeScreenshot*' -name '*.png' -exec cp {} "$SHOTS"/ \;
  if [[ $status != 0 ]]; then
    # Journal et sorties de Maestro (captures de l'échec comprises) gardés pour l'analyse.
    local keep="$ROOT/var/e2e/states-failure"
    rm -rf "$keep" && mkdir -p "$keep" && cp -r "$out"/. "$keep"/ && cp "$WORK/maestro.log" "$keep"/
    grep -E "FAILED|Error|rror:" "$WORK/maestro.log" | head -5 || tail -5 "$WORK/maestro.log"
    echo "  ✗ $(basename "$flow" .yaml) ($t) : détails dans var/e2e/states-failure/"
    rm -rf "$out"
    exit "$status"
  fi
  rm -rf "$out"
}
fixture() { python3 -c "import json,sys; d=json.load(open('$ROOT/var/e2e/fixtures.json')); print($1)"; }
manager() { node scripts/e2e-manager.mts "$@" > /dev/null; }
psql_e2e() {
  docker exec -i gostation-postgres-1 psql -q -U "$(grep '^POSTGRES_USER=' "$ROOT/.env" | cut -d= -f2)" -d gostation_e2e -v ON_ERROR_STOP=1 -c "$1"
}
# Animation de rayon : enregistrement de l'écran autour de l'appui sur « Rechercher ».
record_radius() {
  local t=$1 bounds x y
  "$ADB" shell am force-stop dev.mobile.maestro > /dev/null 2>&1 || true
  "$ADB" shell uiautomator dump /sdcard/ui.xml > /dev/null
  "$ADB" pull -q /sdcard/ui.xml "$WORK/ui.xml"
  bounds=$(python3 - "$WORK/ui.xml" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'resource-id="search-submit"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
x1, y1, x2, y2 = map(int, m.groups())
print((x1 + x2) // 2, (y1 + y2) // 2)
PY
)
  read -r x y <<< "$bounds"
  "$ADB" shell screenrecord --time-limit 4 /sdcard/radius.mp4 &
  local rec=$!
  sleep 1.5
  "$ADB" shell input tap "$x" "$y"
  wait "$rec" || true
  "$ADB" pull -q /sdcard/radius.mp4 "$WORK/radius.mp4"
  # Image retenue : pendant la recherche (bouton orange, libellé « Recherche des stations… » au lieu
  # de « Rechercher », pas encore de résultats), celle où les ondes changent le plus la carte par
  # rapport à l'image d'avant l'appui. 30 images/s : une recherche servie vite ne dure que 200 ms.
  rm -rf "$WORK/frames" && mkdir -p "$WORK/frames"
  ffmpeg -loglevel error -y -ss 1.4 -t 2 -i "$WORK/radius.mp4" -vf fps=30 "$WORK/frames/%03d.png"
  python3 - "$WORK/frames" "$SHOTS/05-searching-$t.png" "$y" "$("$ADB" shell wm size | tr -d '\r' | grep -oE '[0-9]+$' | tail -1)" <<'PY'
import shutil, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
frames = sorted(Path(sys.argv[1]).glob('*.png'))
button = int(sys.argv[3]) / int(sys.argv[4])
def rgb(path):
    return Image.open(path).convert('RGB')
def searching(im):
    # Bord gauche du bouton « Rechercher » / « Recherche des stations… » : orange plein.
    w, h = im.size
    px = im.crop((int(w * 0.05), int(h * button) - 8, int(w * 0.18), int(h * button) + 8)).get_flattened_data()
    return sum(1 for r, g, b in px if r > 190 and b < 90 and r - b > 130) > 0.8 * len(px)
def diff(im, ref, box):
    return sum(ImageStat.Stat(ImageChops.difference(im.crop(box), ref.crop(box))).mean)
ref = rgb(frames[0])
w, h = ref.size
label = (int(w * 0.25), int(h * button) - 20, int(w * 0.75), int(h * button) + 20)
mapbox = (0, int(h * 0.1), w, int(h * 0.45))
# Libellé du bouton changé (« Recherche des stations… ») et bouton encore orange : recherche en cours.
during = [f for f in frames if searching(rgb(f)) and diff(rgb(f), ref, label) > 8]
if not during:
    sys.exit('aucune image pendant la recherche')
best = max(during, key=lambda f: diff(rgb(f), ref, mapbox))
shutil.copy(best, sys.argv[2])
PY
}

THEMES="${THEMES:-light dark}"
# STEPS : sous-ensemble d'étapes à rejouer (none radius closed denied alert account navigation degraded).
step() { [[ -z "${STEPS:-}" || " $STEPS " == *" $1 "* ]]; }
"$ADB" reverse tcp:8080 tcp:8095 > /dev/null

load_fixtures() {
  RUN=$(fixture "d['run']")
  PASSWORD="Lagune-$RUN-Porto"
  CORRECT=$(fixture "d['correct']['managerEmail']")
  REPORTED=$(fixture "d['reported']['managerEmail']")
  REPORTED_ID=$(fixture "d['reported']['id']")
}
# Fuseau où il fait jour maintenant (9 h à 19 h) : les alertes « de retour en stock » ne partent
# pas entre 21 h et 7 h (heure de Porto-Novo) et attendent 7 h. La nuit, l'étape d'alerte tourne
# donc sur une pile réglée sur ce fuseau (APP_TIMEZONE), seul moyen de voir l'envoi réel.
daytime_zone() {
  python3 - <<'PY'
from datetime import datetime
from zoneinfo import ZoneInfo
zones = ['Africa/Porto-Novo', 'Asia/Tokyo', 'Asia/Kolkata', 'America/New_York', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Dubai']
print(next(z for z in zones if 9 <= datetime.now(ZoneInfo(z)).hour < 19))
PY
}

echo "▶ pile E2E (journal d'accès activé)"
E2E_LOG_LEVEL=info stack_up
load_fixtures

if step none; then
  echo "▶ aucune station (Gaz 7,5 kg à 0 partout)"
  for t in $THEMES; do theme "$t"; run .maestro/states/none.yaml "$t"; done
fi
if step radius; then
  echo "▶ animation de rayon"
  for t in $THEMES; do
    theme "$t"
    for attempt in 1 2 3; do
      run .maestro/states/radius-prep.yaml "$t"
      record_radius "$t" && break
      echo "    recherche trop brève pour être filmée, essai $attempt/3"
      [[ $attempt == 3 ]] && exit 1
    done
  done
fi
if step closed; then
  echo "▶ station fermée aujourd'hui et signalée (seule à avoir du 7,5 kg)"
  manager stock "$REPORTED" "$PASSWORD" "$(curl -fsS http://127.0.0.1:8095/api/v1/products | python3 -c "import json,sys; print([p['code'] for p in json.load(sys.stdin)['items'] if p.get('sizeKg') == 7.5][0])")" 9
  # Une saisie de stock vaut confirmation et efface les signalements : le signalement vient après,
  # puis la fermeture, dont l'écriture invalide le cache de recherche.
  psql_e2e "INSERT INTO station_report_flags (station_id, reason, reporters) VALUES ('$REPORTED_ID', 'station_closed', 3) ON CONFLICT DO NOTHING"
  manager close-today "$REPORTED" "$PASSWORD"
  for t in $THEMES; do theme "$t"; run .maestro/states/closed.yaml "$t"; done
fi
if step denied; then
  echo "▶ localisation refusée, hors connexion"
  for t in $THEMES; do
    theme "$t"
    run .maestro/states/location-denied.yaml "$t"
    run .maestro/states/offline.yaml "$t"
  done
fi
if step alert; then
  echo "▶ alerte « de retour en stock » (le gérant remet du gasoil)"
  ZONE=$(daytime_zone)
  if [[ $ZONE != Africa/Porto-Novo ]]; then
    echo "    heures calmes à Porto-Novo : pile relancée sur le fuseau $ZONE"
    stack_down
    APP_TIMEZONE=$ZONE E2E_LOG_LEVEL=info stack_up
    load_fixtures
  fi
  for t in $THEMES; do
    theme "$t"
    run .maestro/states/alert-setup.yaml "$t"
    manager stock "$CORRECT" "$PASSWORD" diesel 800
    sleep 6
    run .maestro/states/inbox.yaml "$t"
    manager stock "$CORRECT" "$PASSWORD" diesel 0
  done
  if [[ $ZONE != Africa/Porto-Novo ]]; then
    stack_down
    E2E_LOG_LEVEL=info stack_up
    load_fixtures
  fi
fi
if step account; then
  echo "▶ gestion du compte"
  for t in $THEMES; do theme "$t"; run .maestro/states/account.yaml "$t"; done
fi
if step navigation; then
  echo "▶ guidage avec trajet simulé"
  read -r SLAT SLNG <<< "$(curl -fsS -H 'X-Install-Id: 00000000-0000-4000-8000-0000000000e3' \
    'http://127.0.0.1:8095/api/v1/search?lat=6.3654&lng=2.4183&product_id='"$(curl -fsS http://127.0.0.1:8095/api/v1/products | python3 -c "import json,sys; print([p['id'] for p in json.load(sys.stdin)['items'] if p['code']=='lpg_10kg'][0])")" |
    python3 -c "import json,sys; s=json.load(sys.stdin)['results'][0]['station']['location']; print(s['lat'], s['lng'])")"
  for t in $THEMES; do
    theme "$t"
    before=$(grep -c '"route":"/api/v1/routes"' "$ROOT/var/e2e/api.log" || true)
    "$ADB" logcat -c
    # Drapeau FLAG_KEEP_SCREEN_ON de la fenêtre, relevé toutes les 3 s (`|| true` : un relevé à 0 fait
    # sortir grep en erreur, ce qui arrêterait la boucle sous `set -e`).
    ( for _ in $(seq 1 60); do "$ADB" shell dumpsys window windows 2> /dev/null | grep -c "KEEP_SCREEN_ON" || true; sleep 3; done ) > "$WORK/keepawake-$t.txt" 2>&1 &
    sampler=$!
    # Maestro ne résout pas les variables dans les points de `travel` : copie du flux avec les
    # coordonnées de la station (et les sous-flux en chemin absolu).
    sed -e "s#\${STATION_LAT}#$SLAT#; s#\${STATION_LNG}#$SLNG#" -e "s#\.\./common/#$PWD/.maestro/common/#" \
      .maestro/states/navigation.yaml > "$WORK/navigation.yaml"
    run "$WORK/navigation.yaml" "$t"
    kill "$sampler" 2> /dev/null || true
    after=$(grep -c '"route":"/api/v1/routes"' "$ROOT/var/e2e/api.log" || true)
    echo "    itinéraires demandés : $((after - before)) (1 au départ, les suivants = recalculs)"
    echo "    écran maintenu allumé pendant le guidage : $(sort -nr "$WORK/keepawake-$t.txt" | head -1 | grep -q '^[1-9]' && echo oui || echo non)"
    echo "    synthèse vocale sollicitée : $("$ADB" logcat -d | grep -ciE 'TextToSpeech|TtsService|speak') lignes de journal"
  done
fi
stack_down

if step degraded; then
  echo "▶ OSRM coupé : distances estimées et itinéraire indisponible"
  OSRM_URL=http://127.0.0.1:5999 stack_up
  for t in $THEMES; do theme "$t"; run .maestro/states/degraded.yaml "$t"; done
fi
echo "✔ états vérifiés ; captures dans $SHOTS/"
