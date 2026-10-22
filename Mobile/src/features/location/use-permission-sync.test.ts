import { act, renderHook } from '@testing-library/react-native'
import * as Location from 'expo-location'
import { AppState, type AppStateStatus } from 'react-native'

import { useLocation } from './location-store'
import { useLocationPermissionSync } from './use-permission-sync'

const granted = {
  granted: true,
  status: Location.PermissionStatus.GRANTED,
  canAskAgain: true,
  expires: 'never' as const,
  android: { accuracy: 'fine' as const },
}

describe('permission relue au retour des réglages', () => {
  let emit: (s: AppStateStatus) => void = () => {}
  const initial = useLocation.getState()

  beforeEach(() => {
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      emit = listener as (s: AppStateStatus) => void
      return { remove: jest.fn() }
    })
    useLocation.setState({ ...initial, permission: 'denied', canAskAgain: false })
  })
  afterEach(() => jest.restoreAllMocks())

  it('accordée dans les réglages : mode appareil, position mesurée et transmise', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce(granted)
    const locate = jest.fn(async () => ({ lat: 6.36, lng: 2.41 }))
    useLocation.setState({ locate })
    const onLocated = jest.fn()
    await renderHook(() => useLocationPermissionSync(onLocated))
    await act(async () => emit('active'))
    expect(useLocation.getState()).toMatchObject({ permission: 'granted', mode: 'device' })
    expect(locate).toHaveBeenCalled()
    expect(onLocated).toHaveBeenCalledWith({ lat: 6.36, lng: 2.41 })
  })

  it('déjà accordée, ou toujours refusée : aucune mesure', async () => {
    const locate = jest.fn(async () => null)
    useLocation.setState({ locate })
    await renderHook(() => useLocationPermissionSync())
    await act(async () => emit('active'))
    expect(useLocation.getState().permission).toBe('undetermined')
    useLocation.setState({ permission: 'granted' })
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce(granted)
    await act(async () => emit('active'))
    await act(async () => emit('background'))
    expect(locate).not.toHaveBeenCalled()
  })
})
