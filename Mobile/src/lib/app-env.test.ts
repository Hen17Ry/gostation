import { triggerTestCrash } from './app-env'

describe('plantage de test (staging)', () => {
  afterEach(() => jest.useRealTimers())

  // Régression (staging) : Sentry.nativeCrash() laissait un écran blanc sans rapport sous la New
  // Architecture ; l'erreur doit être fatale et non attrapée, pour le gestionnaire global du SDK.
  it('lève une erreur JavaScript non attrapée, hors de React', () => {
    jest.useFakeTimers()
    expect(() => triggerTestCrash()).not.toThrow()
    expect(() => jest.runOnlyPendingTimers()).toThrow('GoStation staging test crash')
  })
})
