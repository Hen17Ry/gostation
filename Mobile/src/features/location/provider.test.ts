import type { GoStationLocationModule, NativeFix } from '../../../modules/gostation-location'

import { androidProvider, chooseProvider, withTimeout } from './provider'

const fix = (over: Partial<NativeFix> = {}): NativeFix => ({
  latitude: 6.3654,
  longitude: 2.4183,
  accuracy: 240,
  altitude: null,
  speed: null,
  heading: null,
  timestamp: 1_000,
  provider: 'network',
  ...over,
})

function fakeNative(over: Partial<GoStationLocationModule> = {}) {
  let listener: ((e: { watchId: number; location: NativeFix }) => void) | null = null
  const native = {
    hasGooglePlayServices: jest.fn(() => false),
    getProviderStatus: jest.fn(() => ({ locationEnabled: true, gps: true, network: true })),
    getLastKnownPosition: jest.fn(async () => fix()),
    getCurrentPosition: jest.fn(async () => fix({ accuracy: 12, provider: 'gps' })),
    startWatching: jest.fn(),
    stopWatching: jest.fn(),
    addListener: jest.fn((_e: 'onLocation', l: typeof listener) => {
      listener = l
      return { remove: jest.fn(() => (listener = null)) }
    }),
    ...over,
  }
  const emit = (watchId: number, location: NativeFix) => listener?.({ watchId, location })
  return { native: native as GoStationLocationModule & typeof native, emit }
}

describe('choix du fournisseur de position', () => {
  it.each([
    { os: 'android', hasPlayServices: true, hasNativeModule: true, expected: 'expo' },
    { os: 'android', hasPlayServices: false, hasNativeModule: true, expected: 'android' },
    // Module local absent (ne devrait pas arriver) : comportement d'avant.
    { os: 'android', hasPlayServices: false, hasNativeModule: false, expected: 'expo' },
    { os: 'ios', hasPlayServices: true, hasNativeModule: false, expected: 'expo' },
  ])('$os, services Google $hasPlayServices, module $hasNativeModule → $expected', ({ expected, ...env }) => {
    expect(chooseProvider(env)).toBe(expected)
  })
})

describe('LocationManager (téléphones sans services Google)', () => {
  it('dernière position connue et mesure converties, options transmises', async () => {
    const { native } = fakeNative()
    const p = androidProvider(native)
    expect(await p.lastKnown(300_000)).toEqual({
      lat: 6.3654,
      lng: 2.4183,
      accuracyM: 240,
      heading: null,
      speed: null,
      at: 1_000,
    })
    expect(native.getLastKnownPosition).toHaveBeenCalledWith(300_000)
    const current = await p.current({ timeoutMs: 15_000, goodAccuracyM: 50, settleMs: 3_000 })
    expect(current?.accuracyM).toBe(12)
    expect(native.getCurrentPosition).toHaveBeenCalledWith({ timeoutMs: 15_000, goodAccuracyM: 50, settleMs: 3_000 })
  })

  it('mesure en échec (délai, localisation coupée) : null, sans exception', async () => {
    const { native } = fakeNative({
      getCurrentPosition: jest.fn(async () => {
        throw new Error('ERR_LOCATION_TIMEOUT')
      }),
      getLastKnownPosition: jest.fn(async () => {
        throw new Error('ERR_LOCATION_UNAUTHORIZED')
      }),
    })
    const p = androidProvider(native)
    expect(await p.current({ timeoutMs: 10, goodAccuracyM: 50, settleMs: 5 })).toBeNull()
    expect(await p.lastKnown(1_000)).toBeNull()
  })

  it('localisation du système : réglage lu dans l’état des fournisseurs', async () => {
    const { native } = fakeNative({
      getProviderStatus: jest.fn(() => ({ locationEnabled: false, gps: false, network: false })),
    })
    expect(await androidProvider(native).servicesEnabled()).toBe(false)
  })

  it('suivi : seulement les positions de ce suivi, arrêt côté natif', async () => {
    const { native, emit } = fakeNative()
    const p = androidProvider(native)
    const seen: number[] = []
    const sub = await p.watch({ intervalMs: 1_000, distanceM: 3 }, (f) => seen.push(f.accuracyM ?? -1))
    const id = jest.mocked(native.startWatching).mock.calls[0]?.[0]
    expect(native.startWatching).toHaveBeenCalledWith(id, { intervalMs: 1_000, distanceM: 3 })
    emit(id!, fix({ accuracy: 8 }))
    emit(id! + 1, fix({ accuracy: 99 }))
    expect(seen).toEqual([8])
    sub.remove()
    expect(native.stopWatching).toHaveBeenCalledWith(id)
  })
})

describe('délai de garde', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('répond null au délai si la mesure ne revient pas', async () => {
    const pending = withTimeout(new Promise<number | null>(() => {}), 1_000)
    jest.advanceTimersByTime(1_000)
    await expect(pending).resolves.toBeNull()
  })

  it('rend la valeur, ou null sur rejet', async () => {
    await expect(withTimeout(Promise.resolve(3), 1_000)).resolves.toBe(3)
    await expect(withTimeout(Promise.reject(new Error('x')), 1_000)).resolves.toBeNull()
  })
})
