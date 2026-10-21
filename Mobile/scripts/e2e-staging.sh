#!/usr/bin/env bash
# Parcours Maestro contre le staging (https://api.gostation.bj), sur un téléphone branché avec le
# build `preview` installé (bandeau Staging). Le serveur fournit le pilotage des parcours gérant
# (e2efixtures serve) et le Mailpit des adresses de test, joints par un tunnel SSH ; à la fin, les
# comptes de test et leurs données sont supprimés du staging (scripts/prod.sh e2e-cleanup).
#
#   npm run e2e:staging                  recherche, itinéraire, inscription, gérant et stocks, push
#   FLOWS=".maestro/2-route.yaml" npm run e2e:staging
#
# Prérequis : accès SSH au serveur (scripts/staging.sh), Maestro dans ~/.maestro/bin.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(cd .. && pwd)"
ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
MAESTRO="${MAESTRO:-$HOME/.maestro/bin/maestro}"
OUT="$ROOT/var/e2e/staging"
FLOWS="${FLOWS:-.maestro/1-search-without-account.yaml .maestro/2-route.yaml .maestro/3-sign-up.yaml .maestro/9-manager-setup.yaml .maestro/staging/push.yaml}"
mkdir -p "$OUT"

TEST_DOC=/sdcard/Download/gostation-justificatif-e2e.pdf
media_scan() { "$ADB" shell content call --method scan_volume --uri content://media --arg external_primary > /dev/null 2>&1 || true; }

tunnel=""
cleanup() {
  "$ADB" shell rm -f "$TEST_DOC" > /dev/null 2>&1 || true
  media_scan
  [[ -n "$tunnel" ]] && kill "$tunnel" 2> /dev/null || true
  "$ROOT/scripts/staging.sh" prod e2e-control down > /dev/null 2>&1 || true
  echo "▶ nettoyage du staging (comptes de test)"
  "$ROOT/scripts/staging.sh" prod e2e-cleanup || echo "✗ nettoyage incomplet : scripts/staging.sh prod e2e-cleanup"
}
trap cleanup EXIT INT TERM

echo "▶ pilotage des parcours sur le serveur"
"$ROOT/scripts/staging.sh" prod e2e-control up
"$ROOT/scripts/staging.sh" tunnel > "$OUT/tunnel.log" 2>&1 &
tunnel=$!
for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:18097/healthz 2> /dev/null && break; sleep 1; done
curl -fsS -o /dev/null http://127.0.0.1:18097/healthz || { echo "✗ tunnel indisponible (voir $OUT/tunnel.log)"; exit 1; }

"$ADB" push .maestro/assets/gostation-justificatif-e2e.pdf "$TEST_DOC" > /dev/null
"$ADB" shell touch "$TEST_DOC"
media_scan

status=0
for flow in $FLOWS; do
  name="$(basename "$flow" .yaml)"
  echo "▶ Maestro : $flow"
  # shellcheck disable=SC2086
  "$MAESTRO" test "$flow" -e MAILPIT_URL=http://127.0.0.1:18025 -e CONTROL_URL=http://127.0.0.1:18097 \
    --format junit --output "$OUT/$name.xml" --test-output-dir "$OUT/$name" ${MAESTRO_ARGS:-} || status=1
done
exit "$status"
