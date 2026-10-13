# Réglages de l'appareil que les scripts modifient (thème, taille de police, mode avion, barre d'état),
# relevés au début et rétablis à la fin : sur un téléphone personnel, son propriétaire retrouve les
# siens (mode sombre, police agrandie…). Barre d'état en mode démo pendant les captures : heure fixe,
# aucune icône de notification personnelle.
# Usage (ADB défini) : source scripts/device.sh ; device_save au début, device_restore dans le trap.

device_save() {
  DEVICE_NIGHT=$("$ADB" shell cmd uimode night | tr -d '\r' | awk '{print $NF}')
  DEVICE_FONT=$("$ADB" shell settings get system font_scale | tr -d '\r')
  [[ $DEVICE_FONT == null ]] && DEVICE_FONT=1.0
  DEVICE_AIRPLANE=$("$ADB" shell settings get global airplane_mode_on | tr -d '\r')
  DEVICE_DEMO=$("$ADB" shell settings get global sysui_demo_allowed | tr -d '\r')
}

device_restore() {
  "$ADB" shell cmd uimode night "${DEVICE_NIGHT:-no}" > /dev/null 2>&1 || true
  "$ADB" shell settings put system font_scale "${DEVICE_FONT:-1.0}" > /dev/null 2>&1 || true
  if [[ ${DEVICE_AIRPLANE:-0} != 1 ]]; then
    "$ADB" shell cmd connectivity airplane-mode disable > /dev/null 2>&1 || true
  fi
  demo_off
}

demo() { "$ADB" shell am broadcast -a com.android.systemui.demo -e command "$@" > /dev/null 2>&1 || true; }
demo_on() {
  "$ADB" shell settings put global sysui_demo_allowed 1 > /dev/null 2>&1 || true
  demo enter
  demo clock -e hhmm 0941
  demo battery -e level 100 -e plugged false
  demo network -e wifi show -e level 4
  demo network -e mobile hide
  demo notifications -e visible false
}
demo_off() {
  demo exit
  if [[ ${DEVICE_DEMO:-null} == null ]]; then
    "$ADB" shell settings delete global sysui_demo_allowed > /dev/null 2>&1 || true
  else
    "$ADB" shell settings put global sysui_demo_allowed "$DEVICE_DEMO" > /dev/null 2>&1 || true
  fi
}
