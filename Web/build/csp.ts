import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Plugin, PreviewServer } from 'vite'

/**
 * En-têtes de sécurité de l'admin (étape 10B). En production, Caddy sert le build statique : il
 * lit la CSP dans `dist/csp.txt` (placeholder `{file.*}`) et pose les autres en-têtes, recopiés de
 * `ADMIN_HEADERS` dans `deploy/Caddyfile` (un test compare les deux). `vite preview`, donc les E2E
 * et Lighthouse, servent exactement les mêmes en-têtes.
 */

/** Tuiles, styles, glyphes et sprites de la carte : OpenFreeMap uniquement (CLAUDE.md, règle 6). */
export const TILES_ORIGIN = 'https://tiles.openfreemap.org'

/** Fichier écrit à côté d'index.html, lu par Caddy et par `vite preview`. */
export const CSP_FILE = 'csp.txt'

/** En-têtes fixes, hors CSP (même valeur dans deploy/Caddyfile). */
export const ADMIN_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Isolation inter-origines complète : tout sous-ressource d'une autre origine doit être servie
  // en CORS (tuiles OpenFreeMap) ou l'autoriser explicitement.
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

/**
 * CSP de l'admin. Scripts : le build et les deux scripts en ligne d'index.html (thème avant le
 * premier rendu, préchargement de la page d'arrivée), par empreinte SHA-256 ; ni `unsafe-inline`
 * ni `unsafe-eval`. Styles : `unsafe-inline` reste nécessaire (feuilles injectées par Radix pour
 * bloquer le défilement, par sonner et par le graphique shadcn), sans risque d'exécution de code.
 * MapLibre et pdf.js : workers du build (`self`) ; `blob:` pour les images et les fichiers lus en
 * mémoire (justificatif, D48). Connexions : l'API (même origine en dev et en preview, sinon
 * `VITE_API_BASE_URL`) et OpenFreeMap.
 */
export function contentSecurityPolicy({
  apiOrigin,
  errorsOrigin,
  scriptHashes,
}: {
  apiOrigin?: string
  /** GlitchTip (VITE_SENTRY_DSN), s'il est configuré. */
  errorsOrigin?: string
  scriptHashes: string[]
}): string {
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", ...scriptHashes.map((h) => `'${h}'`)]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'"]],
    [
      'connect-src',
      ["'self'", ...(apiOrigin ? [apiOrigin] : []), ...(errorsOrigin ? [errorsOrigin] : []), TILES_ORIGIN, 'blob:'],
    ],
    ['worker-src', ["'self'", 'blob:']],
    ['frame-src', ["'none'"]],
    ['object-src', ["'none'"]],
    ['manifest-src', ["'self'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ]
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ')
}

/** Empreintes `sha256-…` des scripts en ligne (sans `src`) d'une page HTML. */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>()
  for (const m of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    hashes.add(`sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}`)
  }
  return [...hashes]
}

/** Origine d'une URL d'API absolue ; `undefined` pour une base relative (même origine). */
export function apiOriginOf(baseUrl: string | undefined): string | undefined {
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) return undefined
  return new URL(baseUrl).origin
}

/**
 * Build : écrit `csp.txt` d'après l'index.html final. Preview : pose la CSP et `ADMIN_HEADERS` sur
 * chaque réponse, comme Caddy.
 */
export function securityHeaders(apiBaseUrl: string | undefined, sentryDsn?: string): Plugin {
  let outDir = 'dist'
  return {
    name: 'gostation:security-headers',
    enforce: 'post',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    generateBundle(_, bundle) {
      const index = bundle['index.html']
      if (!index || index.type !== 'asset') return
      const html = typeof index.source === 'string' ? index.source : new TextDecoder().decode(index.source)
      const csp = contentSecurityPolicy({
        apiOrigin: apiOriginOf(apiBaseUrl),
        errorsOrigin: apiOriginOf(sentryDsn),
        scriptHashes: inlineScriptHashes(html),
      })
      this.emitFile({ type: 'asset', fileName: CSP_FILE, source: csp })
    },
    configurePreviewServer(server: PreviewServer) {
      const csp = readFileSync(resolve(outDir, CSP_FILE), 'utf8').trim()
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Content-Security-Policy', csp)
        for (const [name, value] of Object.entries(ADMIN_HEADERS)) res.setHeader(name, value)
        next()
      })
    },
  }
}
