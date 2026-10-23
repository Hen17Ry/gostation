/**
 * Tokens du site générés depuis la source unique du design system (Web/src/styles/globals.css) :
 *   - src/styles/tokens.generated.css : primitives (orange GoStation, neutres chauds) pour Tailwind
 *     et rôles sémantiques clair / sombre (thème du système) ;
 *   - src/lib/tokens.generated.ts : les mêmes couleurs en hex, pour WebGL et le Canvas 2D.
 * Lancement : npm run gen:tokens (Node 24 exécute ce fichier TypeScript directement). La CI vérifie
 * que les deux fichiers sont à jour.
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

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

/** Rôles repris par le site (le reste de l'admin, graphiques et barre latérale, n'y sert pas). */
const ROLES = [
  'background',
  'foreground',
  'surface',
  'surface-sunken',
  'card',
  'card-foreground',
  'primary',
  'primary-foreground',
  'primary-hover',
  'primary-subtle',
  'primary-subtle-foreground',
  'brand-text',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'border',
  'border-strong',
  'input',
  'ring',
  'destructive',
  'success',
  'warning',
] as const

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

/** Valeur CSS d'un rôle : la référence à une primitive est gardée, sinon la valeur source. */
function cssValue(value: string): string {
  const ref = value.match(/^var\(--color-([a-z0-9-]+)\)$/)
  return ref ? `var(--color-${ref[1]})` : value
}

function roles(scope: Record<string, string>) {
  return ROLES.map((role) => {
    const v = scope[role]
    if (!v || !resolve(v, scope)) throw new Error(`token ${role} non résolu`)
    return `  --${role}: ${cssValue(v)};`
  }).join('\n')
}

const primitiveLines = (['brand', 'neutral'] as const)
  .flatMap((p) =>
    STEPS.map((n) => {
      const v = primitives[`color-${p}-${n}`]
      if (!v) throw new Error(`primitive ${p}-${n} introuvable`)
      return `  --color-${p}-${n}: ${v};`
    }),
  )
  .join('\n')

writeFileSync(
  `${root}src/styles/tokens.generated.css`,
  `/* Généré par scripts/gen-tokens.mts depuis Web/src/styles/globals.css : ne pas modifier. */

/* Primitives : orange GoStation (flamme → braise) et neutres chauds. La palette par défaut de
   Tailwind est désactivée : aucune couleur brute ne se glisse dans un composant. */
@theme static {
  --color-*: initial;
  --color-white: ${primitives['color-white']};
  --color-black: ${primitives['color-black']};
${primitiveLines}
}

/* Rôles sémantiques, thème clair. */
:root {
  color-scheme: light dark;
${roles(light)}
}

/* Rôles sémantiques, thème sombre (choisis pour le fond sombre, pas une inversion). */
@media (prefers-color-scheme: dark) {
  :root {
${roles({ ...light, ...dark })
  .split('\n')
  .map((l) => `  ${l}`)
  .join('\n')}
  }
}
`,
)

const hexPalette = (p: 'brand' | 'neutral') =>
  Object.fromEntries(
    STEPS.map((n) => {
      const hex = resolve(primitives[`color-${p}-${n}`] ?? '', primitives)
      if (!hex) throw new Error(`primitive ${p}-${n} non résolue`)
      return [n, hex]
    }),
  )

writeFileSync(
  `${root}src/lib/tokens.generated.ts`,
  `/* Généré par scripts/gen-tokens.mts depuis Web/src/styles/globals.css : ne pas modifier. */
export const palette = ${JSON.stringify({ brand: hexPalette('brand'), neutral: hexPalette('neutral') }, null, 2)} as const
`,
)
console.log(`✓ ${ROLES.length} rôles × 2 thèmes, 2 palettes`)
