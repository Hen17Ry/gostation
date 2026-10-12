import { describe, expect, it } from 'vitest'

import { freshnessOf } from './freshness'
import { formatBytes, formatDistance, formatRelative } from './format'

const now = Date.parse('2026-10-11T12:00:00Z')
const ago = (h: number) => new Date(now - h * 3600_000).toISOString()

describe('fraîcheur des stocks (mêmes seuils que l’API)', () => {
  it('à jour < 8 h, à rafraîchir 8–24 h, expirés au-delà, jamais saisis', () => {
    expect(freshnessOf(ago(7.9), now)).toBe('fresh')
    expect(freshnessOf(ago(8), now)).toBe('stale')
    expect(freshnessOf(ago(23.9), now)).toBe('stale')
    expect(freshnessOf(ago(24), now)).toBe('expired')
    expect(freshnessOf(null, now)).toBe('none')
  })
})

describe('formats', () => {
  it('« il y a » relatif', () => {
    // Intl insère des espaces insécables : on compare le texte lu.
    const rel = (iso: string) => formatRelative(iso, now).replace(/\s/g, ' ')
    expect(rel(new Date(now - 20_000).toISOString())).toBe('à l’instant')
    expect(rel(new Date(now - 5 * 60_000).toISOString())).toBe('il y a 5 min')
    expect(rel(ago(3))).toBe('il y a 3 h')
    expect(rel(ago(72))).toBe('il y a 3 j')
  })

  it('distances et tailles', () => {
    const n = (s: string) => s.replace(/\s/g, ' ')
    expect(n(formatDistance(801))).toBe('801 m')
    expect(n(formatDistance(1234))).toBe('1,2 km')
    expect(n(formatDistance(25_400))).toBe('25 km')
    expect(n(formatBytes(512))).toBe('512 o')
    expect(n(formatBytes(380 * 1024))).toBe('380 Ko')
    expect(n(formatBytes(3.4 * 1024 * 1024))).toBe('3,4 Mo')
  })
})
