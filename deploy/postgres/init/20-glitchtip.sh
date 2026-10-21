#!/usr/bin/env bash
# Premier démarrage de PostgreSQL seulement (base vide) : base et rôle dédiés à GlitchTip (D90),
# sans aucun droit sur la base de GoStation. Sur une base déjà initialisée : voir docs/DEPLOY.md.
set -Eeuo pipefail
psql -v ON_ERROR_STOP=1 -v pw="$GLITCHTIP_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE glitchtip LOGIN PASSWORD :'pw';
CREATE DATABASE glitchtip OWNER glitchtip;
REVOKE ALL ON DATABASE glitchtip FROM PUBLIC;
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SQL
