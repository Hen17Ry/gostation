import { createSplashGate, MAX_WAIT_MS } from './splash'

jest.mock('expo-splash-screen', () => ({ hideAsync: jest.fn(async () => undefined) }))

describe('createSplashGate', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('attend la session locale et la première image de la carte', () => {
    const hide = jest.fn()
    const ready = createSplashGate(hide)
    ready('session')
    expect(hide).not.toHaveBeenCalled()
    ready('map')
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('masque l’écran au plus tard 2,5 s après la session si la carte tarde', () => {
    const hide = jest.fn()
    const ready = createSplashGate(hide)
    ready('session')
    jest.advanceTimersByTime(MAX_WAIT_MS - 1)
    expect(hide).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(hide).toHaveBeenCalledTimes(1)
    ready('map')
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('ne dépend pas de l’ordre des conditions', () => {
    const hide = jest.fn()
    const ready = createSplashGate(hide)
    ready('map')
    expect(hide).not.toHaveBeenCalled()
    ready('session')
    expect(hide).toHaveBeenCalledTimes(1)
  })
})
