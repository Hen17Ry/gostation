/**
 * Tokens du mobile générés depuis la source unique du design system (Web/src/styles/globals.css) :
 * primitives (orange GoStation, neutres chauds) et rôles sémantiques clair / sombre, résolus et
 * convertis en hex (React Native ne lit pas l'oklch). Lancement : npm run gen:tokens
 * (Node 24 exécute ce fichier TypeScript directement).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseColor, toHex } from '../../Web/src/lib/color.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const css = readFileSync(`${root}../Web/src/styles/globals.css`, 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`bloc ${selector} introuvable`)
  const end = css.indexOf('\n}', start)
  const body = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '')
  const vars: Record<string, string> = {}
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[m[1]!] = m[2]!.trim()
  return vars
}

const primitives = block('@theme static')
const light = block(':root')
const dark = block('.dark')

function resolve(value: string, scope: Record<string, string>, depth = 0): string | null {
  if (depth > 8) return null
  const ref = value.match(/^var\(--([a-z0-9-]+)\)$/)
  if (ref) {
    const next = scope[ref[1]!] ?? primitives[ref[1]!]
    return next ? resolve(next, scope, depth + 1) : null
  }
  const c = parseColor(value)
  return c ? toHex(c) : null
}

/** Rôles exportés (ceux qui ont un sens sur mobile). */
const ROLES = [
  'background',
  'foreground',
  'surface',
  'surface-sunken',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'primary-hover',
  'primary-subtle',
  'primary-subtle-foreground',
  'brand-text',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'border',
  'border-strong',
  'input',
  'ring',
  'destructive',
  'destructive-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'info',
  'info-foreground',
  'success-subtle',
  'success-subtle-foreground',
  'warning-subtle',
  'warning-subtle-foreground',
  'danger-subtle',
  'danger-subtle-foreground',
  'info-subtle',
  'info-subtle-foreground',
  'status-good',
  'status-warning',
  'status-critical',
] as const

function scheme(overrides: Record<string, string>) {
  const scope = { ...light, ...overrides }
  const out: Record<string, string> = {}
  for (const role of ROLES) {
    const v = scope[role]
    const hex = v ? resolve(v, scope) : null
    if (!hex) throw new Error(`token ${role} non résolu`)
    out[role] = hex
  }
  return out
}

const palette = (prefix: string) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => {
      const hex = resolve(primitives[`color-${prefix}-${n}`] ?? '', primitives)
      if (!hex) throw new Error(`primitive ${prefix}-${n} non résolue`)
      return [n, hex]
    }),
  )

const out = {
  brand: palette('brand'),
  neutral: palette('neutral'),
  light: scheme({}),
  dark: scheme(dark),
}

const file = `/* Généré par scripts/gen-tokens.mts depuis Web/src/styles/globals.css — ne pas éditer. */
export const tokens = ${JSON.stringify(out, null, 2)} as const

export type ColorRole = keyof typeof tokens.light
`
writeFileSync(`${root}src/theme/tokens.generated.ts`, file)
// Même contenu pour tailwind.config.js (CommonJS, lu par Node avant toute compilation).
writeFileSync(
  `${root}src/theme/tokens.cjs`,
  `/* Généré par scripts/gen-tokens.mts — ne pas éditer. */\nexports.tokens = ${JSON.stringify(out, null, 2)}\n`,
)
console.log(`✓ ${Object.keys(out.light).length} rôles × 2 thèmes, 2 palettes`)
