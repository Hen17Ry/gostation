# syntax=docker/dockerfile:1
# Image du reverse proxy de production : Caddy, le build de l'admin web (Web/) et le site public
# (pages légales et suppression de compte, docs/legal/*.md). Construite depuis la racine du dépôt
# par docker-compose.prod.yml ; les variables VITE_* sont figées dans le bundle à la build.

FROM node:24-bookworm-slim AS admin
WORKDIR /src/Web
COPY Web/package.json Web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY Web/ ./
ARG VITE_API_BASE_URL
ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_ENVIRONMENT=production
RUN test -n "$VITE_API_BASE_URL" && npm run build && test -s dist/csp.txt

# Pages légales : le générateur de l'app (Node exécute le TypeScript sans dépendance).
FROM node:24-bookworm-slim AS public
WORKDIR /src
COPY Mobile/package.json Mobile/package.json
COPY Mobile/scripts/gen-legal.mts Mobile/scripts/gen-legal.mts
COPY Mobile/src/features/legal/markdown.ts Mobile/src/features/legal/markdown.ts
COPY docs/legal docs/legal
RUN cd Mobile && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/gen-legal.mts --html /out

FROM caddy:2.11.7
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=admin /src/Web/dist /srv/admin
COPY --from=public /out /srv/public
