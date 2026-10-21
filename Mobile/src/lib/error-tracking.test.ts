import * as Sentry from '@sentry/react-native'

import { ApiError } from '@/api/errors'

import { startErrorTracking } from './error-tracking'

const init = Sentry.init as jest.Mock

beforeEach(() => jest.clearAllMocks())

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
  })
})
