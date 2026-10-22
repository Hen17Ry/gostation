import { inboxRefetchOnFocus, pushSupported } from './availability'

describe('push sur ce téléphone', () => {
  it('Android sans services Google : impossible (FCM absent)', () => {
    expect(pushSupported('android', () => false)).toBe(false)
    expect(pushSupported('android', () => true)).toBe(true)
  })

  it('iOS : toujours possible (APNs), sans lire les services Google', () => {
    const playServices = jest.fn(() => false)
    expect(pushSupported('ios', playServices)).toBe(true)
    expect(playServices).not.toHaveBeenCalled()
  })

  it('boîte de réception relue au premier plan quand aucun push ne peut l’annoncer', () => {
    expect(inboxRefetchOnFocus(false, 'granted')).toBe(true)
    expect(inboxRefetchOnFocus(true, 'denied')).toBe(true)
    expect(inboxRefetchOnFocus(true, 'undetermined')).toBe(true)
    // Push possible et autorisé : il annonce les nouveautés (data comptée).
    expect(inboxRefetchOnFocus(true, 'granted')).toBe(false)
  })
})
