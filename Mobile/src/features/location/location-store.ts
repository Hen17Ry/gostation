import * as Location from 'expo-location'
import { create } from 'zustand'

import type { LatLng } from '@/lib/geo'

/**
 * Position de l'utilisateur : **en mémoire seulement** (règle 2), jamais écrite dans MMKV, le
 * cache de requêtes ou les logs. `manual` : point choisi sur la carte quand la localisation est
 * refusée ou indisponible.
 */
export type Permission = 'unknown' | 'undetermined' | 'granted' | 'denied'

interface LocationState {
  permission: Permission
  canAskAgain: boolean
  device: LatLng | null
  accuracyM: number | null
  manual: LatLng | null
  mode: 'device' | 'manual'
  locating: boolean
  refreshPermission: () => Promise<Permission>
  requestPermission: () => Promise<Permission>
  locate: (opts?: { interactive?: boolean }) => Promise<LatLng | null>
  setManual: (p: LatLng) => void
  useDevice: () => void
  setDevice: (p: LatLng, accuracyM: number | null) => void
}

const toPermission = (r: Location.LocationPermissionResponse): Permission =>
  r.granted ? 'granted' : r.status === Location.PermissionStatus.UNDETERMINED ? 'undetermined' : 'denied'

export const useLocation = create<LocationState>((set, get) => ({
  permission: 'unknown',
  canAskAgain: true,
  device: null,
  accuracyM: null,
  manual: null,
  mode: 'device',
  locating: false,

  async refreshPermission() {
    const r = await Location.getForegroundPermissionsAsync()
    const permission = toPermission(r)
    set({
      permission,
      canAskAgain: r.canAskAgain,
      mode: permission === 'granted' && !get().manual ? 'device' : get().mode,
    })
    return permission
  },

  async requestPermission() {
    const r = await Location.requestForegroundPermissionsAsync()
    const permission = toPermission(r)
    set({ permission, canAskAgain: r.canAskAgain })
    if (permission === 'granted') set({ mode: 'device' })
    return permission
  },

  /**
   * Position actuelle : dernière connue récente (< 1 min) d'abord, sinon mesure silencieuse
   * (réseau, puis GPS). `interactive` (appui sur Rechercher) : en dernier recours, Android peut
   * proposer d'activer la précision de la localisation.
   */
  async locate(opts?: { interactive?: boolean }) {
    if (get().permission !== 'granted') return null
    set({ locating: true })
    const attempt = (accuracy: Location.Accuracy, dialog: boolean) =>
      Location.getCurrentPositionAsync({ accuracy, mayShowUserSettingsDialog: dialog }).catch(() => null)
    try {
      const fix =
        (await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 200 }).catch(() => null)) ??
        (await attempt(Location.Accuracy.Balanced, false)) ??
        (await attempt(Location.Accuracy.High, false)) ??
        (opts?.interactive ? await attempt(Location.Accuracy.Balanced, true) : null)
      if (!fix) return null
      const p = { lat: fix.coords.latitude, lng: fix.coords.longitude }
      set({ device: p, accuracyM: fix.coords.accuracy ?? null })
      return p
    } catch {
      return null
    } finally {
      set({ locating: false })
    }
  },

  setManual: (p) => set({ manual: p, mode: 'manual' }),
  useDevice: () => set({ mode: 'device' }),
  setDevice: (p, accuracyM) => set({ device: p, accuracyM }),
}))

/** Point de départ des recherches : position de l'appareil, ou point choisi sur la carte. */
export function searchOrigin(s: Pick<LocationState, 'mode' | 'device' | 'manual'>): LatLng | null {
  return s.mode === 'manual' ? s.manual : (s.device ?? s.manual)
}
