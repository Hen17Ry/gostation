# syntax=docker/dockerfile:1
# Image du reverse proxy de production : Caddy, le build de l'admin web (Web/) et le site public
# (Site/ : l'histoire de GoStation et les textes légaux de docs/legal/*.md). Construite depuis la
# racine du dépôt par docker-compose.prod.yml ; les variables VITE_* et PUBLIC_* sont figées dans
# les bundles à la build.

FROM node:24-bookworm-slim AS admin
WORKDIR /src/Web
COPY Web/package.json Web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY Web/ ./
ARG VITE_API_BASE_URL
ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_ENVIRONMENT=production
ARG VITE_APP_ENV=production
RUN test -n "$VITE_API_BASE_URL" && npm run build && test -s dist/csp.txt

# Site public : Astro statique, CSP par empreintes (dist/csp.txt). Il lit docs/legal/*.md et
# l'analyseur Markdown de l'app (Mobile/src/features/legal/markdown.ts).
FROM node:24-bookworm-slim AS site
WORKDIR /src/Site
COPY Site/package.json Site/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY Site/ ./
COPY docs/legal /src/docs/legal
COPY Mobile/src/features/legal/markdown.ts /src/Mobile/src/features/legal/markdown.ts
# Vérification des types du générateur de tokens (astro check) : il lit la conversion de couleurs du web.
COPY Web/src/lib/color.ts /src/Web/src/lib/color.ts
ARG PUBLIC_SITE_URL
ARG PUBLIC_APP_ENV=production
ARG PUBLIC_APK_URL=
ARG PUBLIC_CONTACT_EMAIL=
ARG PUBLIC_WHATSAPP_NUMBER=
ENV ASTRO_TELEMETRY_DISABLED=1
RUN test -n "$PUBLIC_SITE_URL" && npm run build && test -s dist/csp.txt && test -s dist/suppression-compte.html

FROM caddy:2.11.7
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=admin /src/Web/dist /srv/admin
COPY --from=site /src/Site/dist /srv/public
