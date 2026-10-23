import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { mapPalette } from './map-palette'
import { palette } from './tokens.generated'

const source = readFileSync(new URL('../../../Mobile/scripts/gen-map-styles.mts', import.meta.url), 'utf8')

/** Valeur d'une clé dans le bloc light: { … } ou dark: { … } du générateur de l'app. */
function appValue(theme: 'light' | 'dark', key: string): string {
  const block = source.slice(source.indexOf(`  ${theme}: {`))
  const m = new RegExp(`\\n\\s+${key}: ([^,]+),`).exec(block)
  if (!m) throw new Error(`${theme}.${key} introuvable`)
  const raw = m[1]!.trim()
  const token = /^([nb])\[(\d+)\]$/.exec(raw)
  if (token) return palette[token[1] === 'n' ? 'neutral' : 'brand'][Number(token[2]) as 50]
  return raw.replace(/'/g, '')
}

describe('palette des cartes', () => {
  it('identique à celle de l’app mobile', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const [key, value] of Object.entries(mapPalette[theme]))
        expect(value, `${theme}.${key}`).toBe(appValue(theme, key))
    }
  })
})
