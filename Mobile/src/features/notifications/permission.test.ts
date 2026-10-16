import type * as Notifications from 'expo-notifications'

import { permissionOf } from './permission'

const perm = (granted: boolean, status: string, canAskAgain: boolean) =>
  ({ granted, status, canAskAgain, expires: 'never' }) as Notifications.NotificationPermissionsStatus

describe('état de l’autorisation des notifications', () => {
  it('Android 13+ avant toute demande (« denied » mais demandable) : pas encore refusée', () => {
    expect(permissionOf(perm(false, 'denied', true), false)).toBe('undetermined')
  })

  it('refusée après une demande de l’app, ou quand le système ne la montrera plus', () => {
    expect(permissionOf(perm(false, 'denied', true), true)).toBe('denied')
    expect(permissionOf(perm(false, 'denied', false), false)).toBe('denied')
  })

  it('accordée (Android 12 et moins : d’office)', () => {
    expect(permissionOf(perm(true, 'granted', true), false)).toBe('granted')
  })
})
