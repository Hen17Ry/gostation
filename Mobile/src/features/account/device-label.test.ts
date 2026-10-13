import { deviceLabel } from './device-label'

describe('deviceLabel', () => {
  it('lit le modèle et le système dans l’en-tête de l’app', () => {
    expect(deviceLabel({ client: 'mobile', userAgent: 'GoStation/0.1.0 (Android 16; Pixel 7a)' })).toBe(
      'Pixel 7a · Android 16',
    )
  })

  it('nomme les sessions de l’admin web', () => {
    expect(deviceLabel({ client: 'web', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141' })).toBe(
      'Navigateur web',
    )
  })

  it('garde un libellé pour les anciens clients', () => {
    expect(deviceLabel({ client: 'mobile', userAgent: 'okhttp/4.12.0' })).toBe('okhttp/4.12.0')
    expect(deviceLabel({ client: 'mobile', userAgent: '' })).toBe('Appareil inconnu')
  })
})
