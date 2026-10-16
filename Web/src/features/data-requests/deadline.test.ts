import { describe, expect, it } from 'vitest'

import { daysLeft } from './deadline'

describe('daysLeft', () => {
  const now = Date.parse('2026-10-16T10:00:00Z')

  it('compte les jours entiers restants, arrondis vers le haut', () => {
    expect(daysLeft('2026-11-15T10:00:00Z', now)).toBe(30)
    expect(daysLeft('2026-10-23T09:00:00Z', now)).toBe(7)
    expect(daysLeft('2026-10-16T10:00:01Z', now)).toBe(1)
  })

  it('devient négatif une fois l’échéance passée', () => {
    expect(daysLeft('2026-10-16T10:00:00Z', now)).toBe(-1)
    expect(daysLeft('2026-10-16T09:00:00Z', now)).toBe(-1)
    expect(daysLeft('2026-10-14T09:00:00Z', now)).toBe(-3)
  })
})
