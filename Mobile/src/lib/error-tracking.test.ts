import * as Sentry from '@sentry/react-native'

import { ApiError } from '@/api/errors'

import { startErrorTracking } from './error-tracking'

const init = Sentry.init as jest.Mock

const debugEnv = process.env.EXPO_PUBLIC_SENTRY_DEBUG

beforeEach(() => jest.clearAllMocks())
afterEach(() => {
  process.env.EXPO_PUBLIC_SENTRY_DEBUG = debugEnv
})

describe('suivi des plantages (mobile)', () => {
  it('sans DSN : rien n’est initialisé', () => {
    expect(startErrorTracking('')).toBe(false)
    expect(init).not.toHaveBeenCalled()
  })

  it('avec DSN : ni fil d’Ariane, ni session, ni capture ; utilisateur constant ; erreurs d’API écartées', () => {
    expect(startErrorTracking('https://public@errors.gostation.test/3')).toBe(true)
    const opts = init.mock.calls[0][0]
    expect(opts).toMatchObject({
      sendDefaultPii: false,
      enableAutoSessionTracking: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      maxBreadcrumbs: 0,
    })
    expect(opts.beforeBreadcrumb()).toBeNull()
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'anonymous' })
    const apiError = new ApiError({ status: 500, code: 'internal' })
    expect(opts.beforeSend({ message: 'x' }, { originalException: apiError })).toBeNull()
    expect(opts.beforeSend({ message: 'lat=6.3703', user: { id: 'u' } }, { originalException: new Error() })).toEqual({
      message: 'lat=***',
    })
    // Mode diagnostic éteint par défaut : pas de journaux du SDK, aucun message de test.
    expect(opts.debug).toBe(false)
    expect(Sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('mode diagnostic (EXPO_PUBLIC_SENTRY_DEBUG=1) : journaux et message de test, masquage toujours actif', () => {
    process.env.EXPO_PUBLIC_SENTRY_DEBUG = '1'
    startErrorTracking('https://public@errors.gostation.test/3')
    const opts = init.mock.calls[0][0]
    expect(opts.debug).toBe(true)
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1)
    expect(opts.beforeSend({ message: 'awa@example.bj' }, { originalException: new Error() })).toEqual({
      message: '[email]',
    })
  })
})
