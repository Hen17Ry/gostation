# Scan OWASP ZAP (ligne de base)

> Scans du 2026-10-21, image `ghcr.io/zaproxy/zaproxy:stable`, en local sur la pile E2E isolée (base `gostation_e2e`, API sur 127.0.0.1:8095, supprimée après) et sur le build de production de l'admin servi par `vite preview` (mêmes en-têtes que Caddy). Scan passif seulement : aucune attaque active.

## Commandes

```bash
scripts/e2e-stack.sh up &                    # API 8095 sur une base jetable
cd Web && npm run build && VITE_API_PROXY_TARGET=http://127.0.0.1:8095 npx vite preview --host 127.0.0.1 --port 4173 &
# API : toutes les opérations importées depuis la spec OpenAPI, règles passives (-S)
docker run --rm --network host -v "$PWD/zap:/zap/wrk" ghcr.io/zaproxy/zaproxy:stable \
  zap-api-scan.py -t /zap/wrk/openapi.yaml -f openapi -O http://127.0.0.1:8095 -S -r api.html -J api.json -I
# Admin : araignée classique (2 min) et règles passives
docker run --rm --network host -v "$PWD/zap:/zap/wrk" ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://127.0.0.1:4173/login -m 2 -r admin.html -J admin.json -I
scripts/e2e-stack.sh down                    # base supprimée, emails de test effacés
```

L'araignée AJAX (`-j`) n'est pas utilisée : son navigateur sans tête est resté bloqué deux heures sur l'application monopage. Les écrans authentifiés de l'admin sont couverts autrement : CSP vérifiée sur chaque écran par les E2E (`e2e/a11y.spec.ts`).

## Résultats

| Cible | Avant | Après correctifs | Alertes restantes |
|---|---|---|---|
| API (88 chemins, 119 règles) | 0 échec, 2 avertissements | **0 échec, 0 avertissement** | Informations seulement |
| Admin (64 règles) | 0 échec, 4 avertissements | **0 échec, 3 avertissements** | Acceptées (ci-dessous) |

### Corrigé

| Alerte | Cible | Correctif |
|---|---|---|
| Cross-Origin-Resource-Policy Header Missing or Invalid [90004] (`same-site` jugé insuffisant) | API | `Cross-Origin-Resource-Policy: same-origin`. CORP ne s'applique qu'aux chargements `no-cors` : les appels de l'admin (fetch en mode CORS) et les téléchargements (navigations) ne sont pas touchés |
| Cookie No HttpOnly Flag [10010] | API, `POST /auth/logout` | L'effacement de `gs_csrf` porte `HttpOnly`. Le cookie lui-même reste lisible par le JavaScript à la connexion : c'est le principe du jeton CSRF de l'admin (D43, `admin_integration_test.go`) |
| Cross-Origin-Embedder-Policy Header Missing or Invalid [90004] | Admin | `Cross-Origin-Embedder-Policy: require-corp` : l'admin est isolé (`crossOriginIsolated`), les tuiles OpenFreeMap (servies en CORS) se chargent, E2E des cartes et du justificatif verts |

### Accepté

| Alerte | Cible | Pourquoi |
|---|---|---|
| CSP: style-src unsafe-inline [10055] | Admin | Radix (blocage du défilement), sonner et le graphique shadcn injectent des feuilles de style. Les scripts restent stricts (empreintes, ni `unsafe-inline` ni `unsafe-eval`) ; une injection de style ne peut pas exécuter de code |
| Storable but Non-Cacheable Content [10049] | Admin | `index.html` est servi en `no-cache` exprès (nouvelle version visible aussitôt). En production, Caddy sert `/assets/*` (noms par empreinte) en `immutable` pour un an |
| Modern Web Application [10109] | Admin | Information : application monopage, d'où l'araignée classique |
| A Client Error response code was returned [100000] | API | Information : 401 et 404 attendus sur les routes protégées appelées sans session |
| Authentication Request Identified [10111] | API | Information : routes de connexion repérées |
| Non-Storable / Storable and Cacheable Content [10049] | API | Information : recherche et itinéraire en `no-store` (position, règle 2) ; catalogue et JWKS publics en `max-age=300` |
