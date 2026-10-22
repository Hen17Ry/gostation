import { act, renderHook, waitFor } from '@testing-library/react-native'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { installId } from '@/lib/install-id'

import { usePushPermission } from './permission'
import { type PushRegistrationDeps, registerThisDevice, tokenChangeFilter, usePushRegistration } from './registration'

jest.mock('@/features/auth/use-me', () => ({
  useMe: () => ({ me: { id: 'u1', emailVerified: true }, signedIn: true }),
}))

const device = {
  id: 'd1',
  platform: 'android' as const,
  language: 'fr' as const,
  appVersion: '1.0.0',
  createdAt: '2026-10-15T08:00:00Z',
  lastSeenAt: '2026-10-15T08:00:00Z',
}
const registerMock = () =>
  jest.fn<ReturnType<PushRegistrationDeps['register']>, Parameters<PushRegistrationDeps['register']>>(
    async () => device,
  )

describe('enregistrement de l’appareil push', () => {
  it('envoie le token, la plateforme, l’installation et la langue', async () => {
    const register = registerMock()
    const token = await registerThisDevice({ getToken: async () => 'ExponentPushToken[abc]', register })
    expect(token).toBe('ExponentPushToken[abc]')
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'ExponentPushToken[abc]',
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        installId: installId(),
        language: 'fr',
      }),
    )
  })

  it('token indisponible ou API en échec : null, sans exception (prochain lancement)', async () => {
    const register = registerMock()
    expect(
      await registerThisDevice({
        getToken: async () => {
          throw new Error('no FCM')
        },
        register,
      }),
    ).toBeNull()
    expect(register).not.toHaveBeenCalled()

    expect(
      await registerThisDevice({
        getToken: async () => 'ExponentPushToken[abc]',
        register: async () => {
          throw new Error('network')
        },
      }),
    ).toBeNull()
  })
})

describe('changement de token', () => {
  it('premier token retenu sans enregistrement, puis seulement les vrais changements', () => {
    const changed = tokenChangeFilter()
    expect(changed('fcm-1')).toBe(false)
    expect(changed('fcm-1')).toBe(false)
    expect(changed('fcm-2')).toBe(true)
    expect(changed('fcm-2')).toBe(false)
  })

  // Régression (staging) : sur Android, lire le token réémet l'événement de token avec la même
  // valeur ; chaque enregistrement déclenchait le suivant (boucle de POST /me/devices).
  it('l’écho du token lu à l’enregistrement ne relance pas l’enregistrement', async () => {
    let emit: (t: Notifications.DevicePushToken) => void = () => {}
    jest.mocked(Notifications.addPushTokenListener).mockImplementation((listener) => {
      emit = listener
      return { remove: jest.fn() }
    })
    let deviceToken = 'fcm-1'
    // Échos plafonnés : si la boucle revenait, le test échouerait au lieu de tourner sans fin.
    let echoes = 0
    const register = registerMock()
    const deps: PushRegistrationDeps = {
      getToken: async () => {
        if (echoes++ < 20) setTimeout(() => emit({ type: 'android', data: deviceToken }), 0)
        return `ExponentPushToken[${deviceToken}]`
      },
      register,
    }
    usePushPermission.setState({ status: 'granted' })
    await renderHook(() => usePushRegistration(deps))

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(register).toHaveBeenCalledTimes(1)

    deviceToken = 'fcm-2'
    await act(async () => emit({ type: 'android', data: 'fcm-2' }))
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2))
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(register).toHaveBeenCalledTimes(2)
    expect(register).toHaveBeenLastCalledWith(expect.objectContaining({ token: 'ExponentPushToken[fcm-2]' }))
  })
})
