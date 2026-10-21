import { afterEach, describe, expect, it, vi } from 'vitest'

const init = vi.fn()
const captureException = vi.fn()
vi.mock('@sentry/browser', () => ({
  init,
  captureException,
  globalHandlersIntegration: () => 'global',
  linkedErrorsIntegration: () => 'linked',
  dedupeIntegration: () => 'dedupe',
  browserApiErrorsIntegration: () => 'browser-api',
}))

afterEach(() => vi.resetModules())

describe('suivi des plantages', () => {
  it('sans DSN : le SDK n’est ni chargé ni initialisé', async () => {
    const { startErrorTracking, reportError } = await import('./error-tracking')
    startErrorTracking('')
    reportError(new Error('boom'))
    await new Promise((r) => setTimeout(r, 0))
    expect(init).not.toHaveBeenCalled()
    expect(captureException).not.toHaveBeenCalled()
  })

  it('avec DSN : aucune intégration automatique, erreurs d’API écartées, événements masqués', async () => {
    // Modules rechargés à chaque test (état du SDK) : ApiError doit venir du même chargement.
    const { ApiError } = await import('@/api/errors')
    const { startErrorTracking, reportError } = await import('./error-tracking')
    startErrorTracking('https://public@errors.gostation.test/2')
    await vi.waitFor(() => expect(init).toHaveBeenCalledOnce())
    const opts = init.mock.calls[0]![0]
    expect(opts).toMatchObject({
      defaultIntegrations: false,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    })
    expect(opts.integrations).toEqual(['global', 'linked', 'dedupe', 'browser-api'])
    expect(opts.beforeBreadcrumb()).toBeNull()
    const apiError = new ApiError({ status: 500, code: 'internal' })
    expect(opts.beforeSend({ message: 'x' }, { originalException: apiError })).toBeNull()
    const sent = opts.beforeSend(
      { message: 'awa@example.bj lat=6.3703', user: { id: 'u' } },
      { originalException: new Error() },
    )
    expect(sent).toEqual({ message: '[email] lat=***' })

    reportError(apiError)
    reportError(new TypeError('x is undefined'))
    await vi.waitFor(() => expect(captureException).toHaveBeenCalledOnce())
    expect(captureException.mock.calls[0]![0]).toBeInstanceOf(TypeError)
  })
})
