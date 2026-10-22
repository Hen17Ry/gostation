import * as Location from 'expo-location'

import { precisionWarning, readPositionOnce, useLocation } from './location-store'
import type { Fix, LocationProvider } from './provider'

const mockProvider: jest.Mocked<LocationProvider> = {
  kind: 'android',
  lastKnown: jest.fn(),
  current: jest.fn(),
  servicesEnabled: jest.fn(),
  watch: jest.fn(),
}
jest.mock('./provider', () => ({ locationProvider: () => mockProvider }))

const fix = (accuracyM: number, ageMs = 0, lat = 6.36): Fix => ({
  lat,
  lng: 2.41,
  accuracyM,
  heading: null,
  speed: null,
  at: Date.now() - ageMs,
})

const initial = useLocation.getState()

describe('localisation (services Google ou LocationManager)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useLocation.setState({ ...initial, permission: 'granted' })
    mockProvider.lastKnown.mockResolvedValue(null)
    mockProvider.current.mockResolvedValue(null)
    mockProvider.servicesEnabled.mockResolvedValue(true)
  })

  it('montre tout de suite la dernière position connue, puis l’affine', async () => {
    let resolveCurrent: (f: Fix | null) => void = () => {}
    mockProvider.lastKnown.mockResolvedValue(fix(240, 120_000, 6.3))
    mockProvider.current.mockReturnValue(new Promise((r) => (resolveCurrent = r)))
    const pending = useLocation.getState().locate()
    await new Promise((r) => setTimeout(r, 0))
    // Position affichée avant la mesure fraîche.
    expect(useLocation.getState()).toMatchObject({ device: { lat: 6.3 }, accuracyM: 240, locating: true })
    resolveCurrent(fix(12, 0, 6.31))
    await expect(pending).resolves.toEqual({ lat: 6.31, lng: 2.41 })
    expect(useLocation.getState()).toMatchObject({ device: { lat: 6.31 }, accuracyM: 12, locating: false })
    expect(mockProvider.current).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 15_000 }))
  })

  it('dernière position récente et précise : pas de nouvelle mesure', async () => {
    mockProvider.lastKnown.mockResolvedValue(fix(30, 10_000))
    await expect(useLocation.getState().locate()).resolves.toEqual({ lat: 6.36, lng: 2.41 })
    expect(mockProvider.current).not.toHaveBeenCalled()
  })

  it('aucune mesure à temps : la dernière position connue sert', async () => {
    mockProvider.lastKnown.mockResolvedValue(fix(300, 200_000))
    await expect(useLocation.getState().locate()).resolves.toEqual({ lat: 6.36, lng: 2.41 })
    expect(useLocation.getState().failure).toBeNull()
  })

  it('rien du tout : échec « délai » (message et choix sur la carte)', async () => {
    await expect(useLocation.getState().locate()).resolves.toBeNull()
    expect(useLocation.getState()).toMatchObject({ failure: 'timeout', locating: false, device: null })
  })

  it('localisation du téléphone coupée : échec « off »', async () => {
    mockProvider.servicesEnabled.mockResolvedValue(false)
    await useLocation.getState().locate()
    expect(useLocation.getState().failure).toBe('off')
  })

  it('un seul appel à la fois : les suivants attendent le même résultat', async () => {
    mockProvider.current.mockResolvedValue(fix(10))
    const [a, b] = await Promise.all([useLocation.getState().locate(), useLocation.getState().locate()])
    expect(a).toEqual(b)
    expect(mockProvider.current).toHaveBeenCalledTimes(1)
  })

  it('choix sur la carte : mode manuel sans point, l’échec est effacé', () => {
    useLocation.setState({ failure: 'timeout' })
    useLocation.getState().pickOnMap()
    expect(useLocation.getState()).toMatchObject({ mode: 'manual', manual: null, failure: null })
  })

  it('sans permission : aucune mesure', async () => {
    useLocation.setState({ permission: 'denied' })
    await expect(useLocation.getState().locate()).resolves.toBeNull()
    expect(mockProvider.lastKnown).not.toHaveBeenCalled()
  })

  it('position du signalement : lue sans être rangée dans le store (règle 2)', async () => {
    mockProvider.current.mockResolvedValue(fix(15))
    await expect(readPositionOnce()).resolves.toEqual({ lat: 6.36, lng: 2.41 })
    expect(useLocation.getState().device).toBeNull()
  })
})

describe('position précise ou approximative', () => {
  beforeEach(() => useLocation.setState({ ...initial }))

  it('Android : « coarse » seulement = position approximative', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({
      granted: true,
      status: Location.PermissionStatus.GRANTED,
      canAskAgain: true,
      expires: 'never',
      android: { accuracy: 'coarse' },
    })
    await useLocation.getState().refreshPermission()
    expect(useLocation.getState()).toMatchObject({ permission: 'granted', precise: false })
  })

  it('demande acceptée en précis : précise', async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce({
      granted: true,
      status: Location.PermissionStatus.GRANTED,
      canAskAgain: true,
      expires: 'never',
      android: { accuracy: 'fine' },
    })
    await useLocation.getState().requestPermission()
    expect(useLocation.getState()).toMatchObject({ permission: 'granted', precise: true, mode: 'device' })
  })

  it.each([
    [{ precise: false, accuracyM: 2_000 }, 'approximate'],
    [{ precise: true, accuracyM: 240 }, 'low'],
    [{ precise: true, accuracyM: 100 }, null],
    [{ precise: true, accuracyM: null }, null],
  ] as const)('%o → %s', (over, expected) => {
    expect(precisionWarning({ permission: 'granted', mode: 'device', device: { lat: 6.36, lng: 2.41 }, ...over })).toBe(
      expected,
    )
  })

  it('point choisi sur la carte ou permission refusée : rien à signaler', () => {
    const base = { precise: true, accuracyM: 500, device: { lat: 6.36, lng: 2.41 } }
    expect(precisionWarning({ ...base, permission: 'granted', mode: 'manual' })).toBeNull()
    expect(precisionWarning({ ...base, permission: 'denied', mode: 'device' })).toBeNull()
  })
})
