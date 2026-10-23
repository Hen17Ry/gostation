/**
 * En-têtes de sécurité du site public. Caddy lit la CSP dans `dist/csp.txt` (placeholder
 * `{file.*}`) et pose les autres en-têtes, recopiés de `SITE_HEADERS` dans deploy/Caddyfile (un
 * test compare les deux). Le serveur d'aperçu (scripts/preview.mjs), donc les E2E et Lighthouse,
 * servent exactement les mêmes.
 *
 * Lancé après `astro build` : calcule les empreintes des scripts et styles en ligne de toutes les
 * pages, écrit dist/csp.txt, et échoue sur tout attribut style="" ou gestionnaire on…="" (que seule
 * `unsafe-inline` permettrait).
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CSP_FILE = 'csp.txt'

/** En-têtes fixes, hors CSP (même valeur dans deploy/Caddyfile). */
export const SITE_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`

/** Types de <script> exécutables (un bloc de données JSON-LD n'est pas concerné par la CSP). */
const EXECUTABLE = /^(?:|text\/javascript|module|application\/javascript)$/i

export function inlineHashes(html: string) {
  const scripts = new Set<string>()
  const styles = new Set<string>()
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? ''
    if (/\bsrc=/.test(attrs)) continue
    const type = /\btype=["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? ''
    if (EXECUTABLE.test(type)) scripts.add(sha256(m[2] ?? ''))
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) styles.add(sha256(m[1] ?? ''))
  return { scripts: [...scripts], styles: [...styles] }
}

/** Attributs qui exigeraient `unsafe-inline` (ou `unsafe-hashes`) : interdits. */
export function inlineViolations(html: string): string[] {
  const found: string[] = []
  // Attributs de balises seulement (pas le texte) : style="" et on…="".
  for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
    const t = tag[0]
    if (/\sstyle\s*=/.test(t)) found.push(`style : ${t.slice(0, 80)}`)
    if (/\son[a-z]+\s*=/i.test(t)) found.push(`gestionnaire : ${t.slice(0, 80)}`)
  }
  return found
}

/**
 * CSP du site : tout vient de l'origine (scripts, styles, polices, images), scripts et styles en
 * ligne par empreinte. WebGL ne demande aucune directive ; aucun worker, aucun cadre, aucune
 * origine tierce (polices auto-hébergées).
 */
export function contentSecurityPolicy({ scripts, styles }: { scripts: string[]; styles: string[] }): string {
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'none'"]],
    ['script-src', ["'self'", ...scripts]],
    ['style-src', ["'self'", ...styles]],
    ['img-src', ["'self'"]],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['upgrade-insecure-requests', []],
  ]
  return directives.map(([name, values]) => [name, ...values].join(' ')).join('; ')
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? htmlFiles(p) : e.name.endsWith('.html') ? [p] : []
  })
}

export function buildCsp(dist: string): string {
  const scripts = new Set<string>()
  const styles = new Set<string>()
  const violations: string[] = []
  for (const file of htmlFiles(dist)) {
    const html = readFileSync(file, 'utf8')
    const h = inlineHashes(html)
    h.scripts.forEach((x) => scripts.add(x))
    h.styles.forEach((x) => styles.add(x))
    violations.push(...inlineViolations(html).map((v) => `${file.slice(dist.length + 1)} — ${v}`))
  }
  if (violations.length) throw new Error(`CSP stricte : attributs en ligne interdits\n${violations.join('\n')}`)
  return contentSecurityPolicy({ scripts: [...scripts].sort(), styles: [...styles].sort() })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = fileURLToPath(new URL('../dist', import.meta.url))
  const csp = buildCsp(dist)
  writeFileSync(join(dist, CSP_FILE), `${csp}\n`)
  console.log(`✓ dist/${CSP_FILE} (${csp.length} caractères)`)
}
