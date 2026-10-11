import { describe, expect, it } from 'vitest'

import { contrast, over, parseColor, type Rgba } from '@/lib/color'

import css from './globals.css?raw'

/**
 * Contrastes WCAG AA des tokens, lus dans globals.css (source unique) : 4,5:1 pour le texte,
 * 3:1 pour les indicateurs non textuels (anneau de focus, bordure des champs).
 */
function block(selector: RegExp): Record<string, string> {
  const start = css.search(selector)
  if (start < 0) throw new Error(`bloc introuvable : ${selector}`)
  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++
    if (css[end] === '}' && --depth === 0) break
  }
  const vars: Record<string, string> = {}
  for (const m of css.slice(open + 1, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]!] = m[2]!.trim()
  return vars
}

const primitives = block(/@theme static\s*\{/)
const modes = {
  light: { ...primitives, ...block(/:root\s*\{/) },
  dark: { ...primitives, ...block(/:root\s*\{/), ...block(/\.dark\s*\{/) },
}

function resolve(vars: Record<string, string>, name: string): Rgba {
  let value = vars[name]
  for (let i = 0; value?.startsWith('var('); i++) {
    if (i > 10) throw new Error(`boucle de var() : ${name}`)
    value = vars[value.slice(4, -1).trim()]
  }
  const c = value ? parseColor(value) : null
  if (!c) throw new Error(`couleur illisible : ${name} = ${value}`)
  return c
}

// [texte, fond, fond sous-jacent si le fond est translucide]
const textPairs: [string, string, string?][] = [
  ['--foreground', '--background'],
  ['--card-foreground', '--card'],
  ['--popover-foreground', '--popover'],
  ['--primary-foreground', '--primary'],
  ['--primary-foreground', '--primary-hover'],
  ['--primary-subtle-foreground', '--primary-subtle'],
  ['--brand-text', '--background'],
  ['--brand-text', '--card'],
  ['--secondary-foreground', '--secondary'],
  ['--muted-foreground', '--muted'],
  ['--muted-foreground', '--background'],
  ['--muted-foreground', '--card'],
  ['--accent-foreground', '--accent'],
  ['--destructive-foreground', '--destructive'],
  ['--destructive', '--card'],
  ['--success-foreground', '--success'],
  ['--warning-foreground', '--warning'],
  ['--info-foreground', '--info'],
  ['--success-subtle-foreground', '--success-subtle', '--card'],
  ['--warning-subtle-foreground', '--warning-subtle', '--card'],
  ['--danger-subtle-foreground', '--danger-subtle', '--card'],
  ['--info-subtle-foreground', '--info-subtle', '--card'],
  ['--sidebar-foreground', '--sidebar'],
  ['--foreground', '--sidebar-active'],
]

const nonTextPairs: [string, string][] = [
  ['--ring', '--background'],
  ['--ring', '--card'],
  ['--input', '--card'],
  ['--input', '--background'],
]

describe.each(Object.entries(modes))('tokens %s', (_mode, vars) => {
  it.each(textPairs)('texte %s sur %s ≥ 4,5:1', (fg, bg, base) => {
    const back = base ? over(resolve(vars, bg), resolve(vars, base)) : resolve(vars, bg)
    expect(contrast(resolve(vars, fg), back)).toBeGreaterThanOrEqual(4.5)
  })
  it.each(nonTextPairs)('indicateur %s sur %s ≥ 3:1', (fg, bg) => {
    expect(contrast(resolve(vars, fg), resolve(vars, bg))).toBeGreaterThanOrEqual(3)
  })
})

describe('palette orange', () => {
  it('compte 11 nuances, de 50 à 950, de plus en plus sombres', () => {
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
    const lum = steps
      .map((s) => resolve(primitives, `--color-brand-${s}`))
      .map((c) => contrast(c, { r: 0, g: 0, b: 0, a: 1 }))
    expect(lum).toEqual([...lum].sort((a, b) => b - a))
  })
})
