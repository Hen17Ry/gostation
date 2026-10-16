import { Platform } from 'react-native'

import { installId } from '@/lib/install-id'

import { type PushRegistrationDeps, registerThisDevice } from './registration'

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
