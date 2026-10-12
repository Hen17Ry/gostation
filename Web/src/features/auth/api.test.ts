import { describe, expect, it } from 'vitest'

import { normalizeRecoveryCode, RECOVERY_CODE_PATTERN, safeRedirect } from './api'

describe('redirection après connexion', () => {
  it.each([
    ['/', '/'],
    ['/stations?status=pending', '/stations?status=pending'],
    [undefined, '/'],
    ['https://evil.example/', '/'],
    ['//evil.example/', '/'],
    ['/\\evil.example', '/'],
    ['/login?redirect=%2F', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected)
  })
})

describe('codes de secours', () => {
  it('normalise la saisie (casse, espaces, tirets)', () => {
    expect(normalizeRecoveryCode('k7qd m2xa-pl4r zc3t')).toBe('K7QD-M2XA-PL4R-ZC3T')
    expect(RECOVERY_CODE_PATTERN.test(normalizeRecoveryCode('k7qdm2xapl4rzc3t'))).toBe(true)
    expect(RECOVERY_CODE_PATTERN.test('K7QD-M2XA-PL4R-ZC90')).toBe(false) // 9 et 0 hors base32
  })
})
