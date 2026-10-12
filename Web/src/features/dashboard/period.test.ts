import { describe, expect, it } from 'vitest'

import { isPartialBucket, isValidRange, normalizePeriod, toApiQuery } from './period'

describe('période du tableau de bord', () => {
  it('7 jours par défaut ; une plage incomplète ou invalide retombe sur 7 jours', () => {
    expect(normalizePeriod({})).toEqual({ period: '7d' })
    expect(normalizePeriod({ period: 'custom', from: '2026-10-01' })).toEqual({ period: '7d' })
    expect(normalizePeriod({ period: 'custom', from: '2026-10-05', to: '2026-10-01' })).toEqual({ period: '7d' })
    expect(normalizePeriod({ period: '30d', from: '2026-10-01', to: '2026-10-02' })).toEqual({ period: '30d' })
  })

  it('plage : du premier au dernier jour inclus, 366 jours au plus, jamais dans le futur', () => {
    expect(isValidRange('2026-01-01', '2026-01-01', '2026-10-11')).toBe(true)
    expect(isValidRange('2025-10-11', '2026-10-11', '2026-10-11')).toBe(true) // 366 jours
    expect(isValidRange('2025-10-10', '2026-10-11', '2026-10-11')).toBe(false) // 367 jours
    expect(isValidRange('2026-10-01', '2026-10-12', '2026-10-11')).toBe(false)
  })

  it('paramètres envoyés à l’API', () => {
    expect(toApiQuery({ period: '24h' })).toEqual({ period: '24h' })
    expect(toApiQuery({ period: 'custom', from: '2026-10-01', to: '2026-10-07' })).toEqual({
      period: 'custom',
      from: '2026-10-01',
      to: '2026-10-07',
    })
  })

  it('tranche en cours : partielle si la période se termine avant sa fin', () => {
    const to = '2026-10-11T13:20:00Z'
    expect(isPartialBucket('2026-10-10T23:00:00Z', 'day', to)).toBe(true)
    expect(isPartialBucket('2026-10-09T23:00:00Z', 'day', to)).toBe(false)
    expect(isPartialBucket('2026-10-11T13:00:00Z', 'hour', to)).toBe(true)
    expect(isPartialBucket('2026-10-11T12:00:00Z', 'hour', to)).toBe(false)
  })
})
