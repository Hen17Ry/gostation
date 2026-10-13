#!/usr/bin/env bash
# Audit d'accessibilité sur l'appareil branché (build release, API de dev joignable) : chaque écran
# est ouvert par lien profond, son arbre d'accessibilité extrait par uiautomator puis analysé
# (scripts/a11y-audit.py) ; captures en police agrandie (×1,5) dans var/a11y/.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(cd .. && pwd)"
ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
OUT="$ROOT/var/a11y"
rm -rf "$OUT" && mkdir -p "$OUT/dumps" "$OUT/font-scale"
API="${API:-http://127.0.0.1:8080}"

product=$(curl -fsS "$API/api/v1/products" | python3 -c "import json,sys; print([p['id'] for p in json.load(sys.stdin)['items'] if p['code']=='lpg_10kg'][0])")
station=$(curl -fsS -H 'X-Install-Id: 00000000-0000-4000-8000-0000000000a1' "$API/api/v1/search?lat=6.3654&lng=2.4183&product_id=$product" |
  python3 -c "import json,sys; print(json.load(sys.stdin)['results'][0]['station']['id'])")

SCREENS=(
  "carte|/"
  "favoris|/favorites"
  "notifications|/inbox"
  "compte|/account"
  "station|/station/$station"
  "itineraire|/route/$station"
  "signalement|/report/$station"
  "connexion|/auth/sign-in"
  "inscription|/auth/sign-up"
  "code|/auth/verify?email=ama%40example.test"
  "mot-de-passe-oublie|/auth/forgot"
  "confidentialite|/legal/privacy"
  "hors-zone|/out-of-coverage"
)

open() { "$ADB" shell am start -a android.intent.action.VIEW -d "gostation://${1#/}" bj.gostation.app > /dev/null; sleep "${2:-4}"; }
dump() {
  "$ADB" shell uiautomator dump /sdcard/a11y.xml > /dev/null
  "$ADB" pull -q /sdcard/a11y.xml "$OUT/dumps/$1.xml"
}

"$ADB" shell am force-stop dev.mobile.maestro > /dev/null 2>&1 || true
"$ADB" shell settings put system font_scale 1.0
# Accueil (premier lancement) : état effacé.
"$ADB" shell pm clear bj.gostation.app > /dev/null
"$ADB" shell pm grant bj.gostation.app android.permission.ACCESS_FINE_LOCATION
"$ADB" shell monkey -p bj.gostation.app -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1
sleep 6
dump accueil
# Passe l'accueil (mêmes boutons que le parcours Maestro).
tap_id() {
  "$ADB" shell uiautomator dump /sdcard/step.xml > /dev/null
  "$ADB" pull -q /sdcard/step.xml "$OUT/step.xml"
  local xy
  xy=$(python3 - "$OUT/step.xml" "$1" <<'PY'
import re, sys
x = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'resource-id="%s"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' % sys.argv[2], x)
print((int(m[1]) + int(m[3])) // 2, (int(m[2]) + int(m[4])) // 2)
PY
)
  # shellcheck disable=SC2086
  "$ADB" shell input tap $xy
  sleep 2
}
for id in onboarding-next onboarding-allow-location onboarding-start; do tap_id "$id"; done
sleep 3

for entry in "${SCREENS[@]}"; do
  name=${entry%%|*}
  open "${entry#*|}"
  dump "$name"
done

echo "▶ police ×1,5"
"$ADB" shell settings put system font_scale 1.5
sleep 2
for entry in "carte|/" "station|/station/$station" "inscription|/auth/sign-up" "compte|/account" "itineraire|/route/$station"; do
  name=${entry%%|*}
  open "${entry#*|}" 5
  "$ADB" exec-out screencap -p > "$OUT/font-scale/$name.png"
done
"$ADB" shell settings put system font_scale 1.0

echo "▶ analyse"
python3 scripts/a11y-audit.py "$("$ADB" shell wm density | grep -o '[0-9]*' | tail -1)" "$OUT"/dumps/*.xml
