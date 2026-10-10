#!/usr/bin/env bash
# Prépare les données de routage OSRM de GoStation (profil car, algorithme MLD) :
#   1. télécharge l'extrait Geofabrik (Bénin par défaut) et vérifie son MD5 ; cache dans .cache/osrm/
#   2. lance osrm-extract → osrm-partition → osrm-customize dans Docker (service compose `osrm-tools`)
#   3. publie le résultat dans le volume `osrmdata` et redémarre `osrm` s'il tourne déjà
#
# Usage : scripts/osrm-prepare.sh [--force]
#   --force   retraite même si l'extrait n'a pas changé depuis la dernière préparation
# Variables lues (environnement > .env > défaut) : OSRM_DATASET, OSRM_PBF_URL.
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

CACHE_DIR="$ROOT_DIR/.cache/osrm"
STAGE=/data/.staging
trap 'die "Échec (ligne $LINENO). Les données publiées précédemment restent intactes."' ERR

md5_of() {
  if command -v md5sum > /dev/null; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi
}

tools() { compose run --rm -T osrm-tools "$@"; }

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h | --help) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "Option inconnue : $arg (voir --help)" ;;
  esac
done

command -v docker > /dev/null || die "docker introuvable"
docker compose version > /dev/null 2>&1 || die "Docker Compose v2 requis (docker compose)"
command -v curl > /dev/null || die "curl introuvable"
require_env_file

DATASET="$(env_get OSRM_DATASET benin)"
PBF_URL="$(env_get OSRM_PBF_URL https://download.geofabrik.de/africa/benin-latest.osm.pbf)"
[[ "$DATASET" =~ ^[a-z0-9_-]+$ ]] || die "OSRM_DATASET invalide : '$DATASET'"
PBF="$CACHE_DIR/$DATASET.osm.pbf"
mkdir -p "$CACHE_DIR"

# ── 1. Téléchargement (avec cache et contrôle d'intégrité) ───────────────────
log "Extrait source : $PBF_URL"
remote_md5="$(curl -fsSL --retry 3 "$PBF_URL.md5" 2> /dev/null | cut -d' ' -f1 || true)"
if [[ ! "$remote_md5" =~ ^[0-9a-f]{32}$ ]]; then
  warn "MD5 distant indisponible : pas de vérification d'intégrité."
  remote_md5=""
fi

if [[ -f "$PBF" && -n "$remote_md5" && "$(md5_of "$PBF")" == "$remote_md5" ]]; then
  ok "Extrait en cache déjà à jour ($PBF)"
else
  log "Téléchargement…"
  curl -fL --retry 3 --progress-bar -o "$PBF.part" "$PBF_URL"
  if [[ -n "$remote_md5" && "$(md5_of "$PBF.part")" != "$remote_md5" ]]; then
    rm -f "$PBF.part"
    die "MD5 incorrect : téléchargement corrompu, relance le script."
  fi
  mv "$PBF.part" "$PBF"
  ok "Extrait téléchargé ($(du -h "$PBF" | cut -f1))"
fi
source_md5="$(md5_of "$PBF")"

# ── 2. Déjà préparé pour cet extrait ? ───────────────────────────────────────
published_md5="$(tools sh -c "test -f /data/$DATASET.osrm.mldgr && cat /data/$DATASET.source.md5" 2> /dev/null || true)"
if [[ $FORCE -eq 0 && "$published_md5" == "$source_md5" ]]; then
  ok "Données OSRM déjà à jour pour cet extrait (--force pour retraiter)."
  exit 0
fi

# ── 3. Traitement dans un répertoire de staging du volume ────────────────────
log "Copie de l'extrait dans le volume Docker"
compose run --rm -T -v "$CACHE_DIR:/src:ro" osrm-tools \
  sh -c "rm -rf $STAGE && mkdir -p $STAGE && cp /src/$DATASET.osm.pbf $STAGE/"

log "osrm-extract (profil car)…"
tools osrm-extract -p /opt/car.lua "$STAGE/$DATASET.osm.pbf"

log "osrm-partition…"
tools osrm-partition "$STAGE/$DATASET.osrm"

log "osrm-customize…"
tools osrm-customize "$STAGE/$DATASET.osrm"

# ── 4. Publication : on ne remplace les anciennes données qu'après succès ────
log "Publication du jeu de données « $DATASET »"
tools sh -c "rm -f $STAGE/$DATASET.osm.pbf \
  && echo $source_md5 > $STAGE/$DATASET.source.md5 \
  && rm -f /data/$DATASET.osrm* /data/$DATASET.source.md5 \
  && mv $STAGE/* /data/ && rmdir $STAGE"

if [[ -n "$(compose ps -q --status running osrm 2> /dev/null)" ]]; then
  log "Redémarrage du service osrm pour charger les nouvelles données"
  compose restart osrm
fi

ok "OSRM prêt : $DATASET (car, MLD). Étape suivante : make up"
