import { detectPlayServices } from './play-services'

const native = (available: boolean | Error) => ({
  hasGooglePlayServices: () => {
    if (available instanceof Error) throw available
    return available
  },
})

describe('détection de Google Play Services', () => {
  it('Android : la réponse du module natif (Huawei sans services : faux)', () => {
    expect(detectPlayServices('android', native(true))).toBe(true)
    expect(detectPlayServices('android', native(false))).toBe(false)
  })

  it('Android, module en échec : faux (le repli sans services Google est sûr)', () => {
    expect(detectPlayServices('android', native(new Error('boom')))).toBe(false)
  })

  it('hors Android, ou module local absent : vrai (comportement d’avant gardé)', () => {
    expect(detectPlayServices('ios', native(false))).toBe(true)
    expect(detectPlayServices('android', null)).toBe(true)
  })
})
