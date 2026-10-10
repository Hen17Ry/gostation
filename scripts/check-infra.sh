#!/usr/bin/env bash
# Vérifie l'infra locale GoStation : healthchecks Docker, PostGIS, Redis, et OSRM
# (itinéraire + matrice /table sur Cotonou, comme le fera la recherche).
# Usage : scripts/check-infra.sh   (ou make check)
set -Eeuo pipefail

# shellcheck source=scripts/_lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

require_env_file
OSRM_URL="http://127.0.0.1:$(env_get OSRM_PORT 5000)"

# Points de test (lng,lat — ordre OSRM)
AIRPORT="2.3844,6.3573"   # Aéroport de Cotonou (Cadjehoun)
DANTOKPA="2.4300,6.3730"  # Marché Dantokpa
AKPAKPA="2.4500,6.3600"   # Akpakpa, de l'autre côté de la lagune
FIDJROSSE="2.3400,6.3600" # Fidjrossè

json_num() { grep -o "\"$1\":[0-9.]*" | head -n1 | cut -d: -f2; }

# ── 1. Healthchecks ──────────────────────────────────────────────────────────
for svc in postgres redis osrm; do
  cid="$(compose ps -q "$svc")"
  [[ -n "$cid" ]] || die "$svc : conteneur absent (make up)"
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")"
  [[ "$status" == "healthy" ]] || die "$svc : $status (make logs s=$svc)"
  ok "$svc : healthy"
done

# ── 2. PostGIS ───────────────────────────────────────────────────────────────
postgis="$(compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT PostGIS_Version()"')"
[[ -n "$postgis" ]] || die "PostGIS non activé"
pg="$(compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SHOW server_version"')"
ok "PostgreSQL $pg — PostGIS_Version() = $postgis"

# ── 3. Redis ─────────────────────────────────────────────────────────────────
[[ "$(compose exec -T redis redis-cli ping)" == "PONG" ]] || die "Redis ne répond pas"
policy="$(compose exec -T redis redis-cli config get maxmemory-policy | tail -n1)"
[[ "$policy" == "noeviction" ]] || warn "Redis maxmemory-policy = $policy (attendu : noeviction)"
ok "Redis : PONG (maxmemory-policy=$policy)"

# ── 4. OSRM : itinéraire aéroport → Dantokpa ─────────────────────────────────
route="$(curl -fsS "$OSRM_URL/route/v1/driving/$AIRPORT;$DANTOKPA?overview=false")" || die "OSRM /route injoignable"
[[ "$route" == *'"code":"Ok"'* ]] || die "OSRM /route : $route"
dist="$(json_num distance <<< "$route")"
dur="$(json_num duration <<< "$route")"
ok "OSRM /route aéroport → Dantokpa : $(awk "BEGIN{printf \"%.1f km, %.0f min\", $dist/1000, $dur/60}")"

# ── 5. OSRM : matrice 1 → N (re-classement de la recherche) ──────────────────
table="$(curl -fsS "$OSRM_URL/table/v1/driving/$AIRPORT;$DANTOKPA;$AKPAKPA;$FIDJROSSE?sources=0&annotations=duration,distance")" \
  || die "OSRM /table injoignable"
[[ "$table" == *'"code":"Ok"'* ]] || die "OSRM /table : $table"
durations="$(grep -o '"durations":\[\[[^]]*\]\]' <<< "$table" | sed 's/"durations":\[\[//; s/\]\]//')"
ok "OSRM /table depuis l'aéroport (s) → Dantokpa, Akpakpa, Fidjrossè : ${durations#*,}"

ok "Infra opérationnelle."
