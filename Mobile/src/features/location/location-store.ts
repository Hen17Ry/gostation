import * as Location from 'expo-location'
import { create } from 'zustand'

import type { LatLng } from '@/lib/geo'

import { useLocateTiming } from './diagnostics'
import { type Fix, locationProvider } from './provider'

/**
 * Position de l'utilisateur : **en mémoire seulement** (règle 2), jamais écrite dans MMKV, le
 * cache de requêtes ou les logs. `manual` : point choisi sur la carte quand la localisation est
 * refusée ou indisponible. Fournisseur (services Google ou LocationManager) : `./provider`.
 */
export type Permission = 'unknown' | 'undetermined' | 'granted' | 'denied'

/** Échec de la dernière mesure : localisation du téléphone coupée, ou aucune position à temps. */
export type LocateFailure = 'off' | 'timeout'

/** Dernière position connue montrée tout de suite si elle a moins de 5 min. */
export const KNOWN_MAX_AGE_MS = 5 * 60_000
/** Elle suffit, sans nouvelle mesure, si elle a moins d'une minute et ±100 m au plus. */
const KNOWN_FRESH_MS = 60_000
/** Au-delà de ±100 m, la précision est signalée à l'utilisateur. */
export const LOW_ACCURACY_M = 100
/** Délai d'une mesure (GPS qui cherche encore le signal) avant le message et le choix sur la carte. */
export const LOCATE_TIMEOUT_MS = 15_000
const GOOD_ACCURACY_M = 50
const SETTLE_MS = 3_000

interface LocationState {
  permission: Permission
  canAskAgain: boolean
  /** Position précise accordée (Android 12+ et iOS : l'utilisateur peut n'accorder que l'approximative). */
  precise: boolean
  device: LatLng | null
  accuracyM: number | null
  manual: LatLng | null
  mode: 'device' | 'manual'
  locating: boolean
  failure: LocateFailure | null
  refreshPermission: () => Promise<Permission>
  requestPermission: () => Promise<Permission>
  locate: (opts?: { interactive?: boolean }) => Promise<LatLng | null>
  setManual: (p: LatLng) => void
  /** Choix sur la carte sans point encore : le prochain toucher de la carte le pose. */
  pickOnMap: () => void
  useDevice: () => void
  setDevice: (p: LatLng, accuracyM: number | null) => void
}

const toPermission = (r: Location.LocationPermissionResponse): Permission =>
  r.granted ? 'granted' : r.status === Location.PermissionStatus.UNDETERMINED ? 'undetermined' : 'denied'

const isPrecise = (r: Location.LocationPermissionResponse) =>
  r.android ? r.android.accuracy === 'fine' : r.ios ? r.ios.accuracy !== 'reduced' : true

const point = (f: Fix): LatLng => ({ lat: f.lat, lng: f.lng })

/** Position utilisable sans nouvelle mesure : récente et précise. */
export function isFreshEnough(f: Fix, now: number): boolean {
  return now - f.at <= KNOWN_FRESH_MS && f.accuracyM !== null && f.accuracyM <= LOW_ACCURACY_M
}

let inflight: Promise<LatLng | null> | null = null

export const useLocation = create<LocationState>((set, get) => ({
  permission: 'unknown',
  canAskAgain: true,
  precise: true,
  device: null,
  accuracyM: null,
  manual: null,
  mode: 'device',
  locating: false,
  failure: null,

  async refreshPermission() {
    const r = await Location.getForegroundPermissionsAsync()
    const permission = toPermission(r)
    set({
      permission,
      canAskAgain: r.canAskAgain,
      precise: isPrecise(r),
      mode: permission === 'granted' && !get().manual ? 'device' : get().mode,
    })
    return permission
  },

  async requestPermission() {
    const r = await Location.requestForegroundPermissionsAsync()
    const permission = toPermission(r)
    set({ permission, canAskAgain: r.canAskAgain, precise: isPrecise(r) })
    if (permission === 'granted') set({ mode: 'device' })
    return permission
  },

  /**
   * Position actuelle. La dernière position connue (< 5 min) est montrée tout de suite (`device`),
   * puis affinée par une mesure (GPS et réseau) ; elle suffit seule si elle a moins d'une minute et
   * ±100 m au plus. Pas de mesure au bout de 15 s : la dernière position connue sert, sinon
   * `failure` (message, choix sur la carte). Un seul appel à la fois : les suivants l'attendent.
   */
  locate(opts?: { interactive?: boolean }) {
    if (get().permission !== 'granted') return Promise.resolve(null)
    inflight ??= (async () => {
      set({ locating: true })
      const provider = locationProvider()
      const started = Date.now()
      const timing = (knownMs: number | null, fixMs: number | null, accuracyM: number | null) =>
        useLocateTiming.setState({ last: { knownMs, fixMs, accuracyM } })
      try {
        const known = await provider.lastKnown(KNOWN_MAX_AGE_MS)
        const knownMs = known ? Date.now() - started : null
        if (known) set({ device: point(known), accuracyM: known.accuracyM })
        if (known && isFreshEnough(known, Date.now())) {
          set({ failure: null })
          timing(knownMs, null, known.accuracyM)
          return point(known)
        }
        const fix = await provider.current({
          timeoutMs: LOCATE_TIMEOUT_MS,
          goodAccuracyM: GOOD_ACCURACY_M,
          settleMs: SETTLE_MS,
          interactive: opts?.interactive,
        })
        const best = fix ?? known
        timing(knownMs, fix ? Date.now() - started : null, best?.accuracyM ?? null)
        if (best) {
          set({ device: point(best), accuracyM: best.accuracyM, failure: null })
          return point(best)
        }
        const enabled = await provider.servicesEnabled().catch(() => true)
        set({ failure: enabled ? 'timeout' : 'off' })
        return null
      } catch {
        return null
      } finally {
        set({ locating: false })
        inflight = null
      }
    })()
    return inflight
  },

  setManual: (p) => set({ manual: p, mode: 'manual', failure: null }),
  pickOnMap: () => set({ manual: null, mode: 'manual', failure: null }),
  useDevice: () => set({ mode: 'device' }),
  setDevice: (p, accuracyM) => set({ device: p, accuracyM }),
}))

/**
 * Position du moment pour une seule requête (contrôle des 2 km d'un signalement) : jamais rangée
 * dans le store ni ailleurs. null si la permission manque ou si aucune position n'arrive à temps.
 */
export async function readPositionOnce(): Promise<LatLng | null> {
  if (useLocation.getState().permission !== 'granted') return null
  const provider = locationProvider()
  const known = await provider.lastKnown(KNOWN_MAX_AGE_MS)
  if (known && isFreshEnough(known, Date.now())) return point(known)
  const fix = await provider.current({
    timeoutMs: LOCATE_TIMEOUT_MS,
    goodAccuracyM: GOOD_ACCURACY_M,
    settleMs: SETTLE_MS,
    interactive: true,
  })
  const best = fix ?? known
  return best ? point(best) : null
}

/** Point de départ des recherches : position de l'appareil, ou point choisi sur la carte. */
export function searchOrigin(s: Pick<LocationState, 'mode' | 'device' | 'manual'>): LatLng | null {
  return s.mode === 'manual' ? s.manual : (s.device ?? s.manual)
}

/** Précision à signaler : position approximative accordée, ou mesure au-delà de ±100 m. */
export function precisionWarning(
  s: Pick<LocationState, 'permission' | 'precise' | 'accuracyM' | 'device' | 'mode'>,
): 'approximate' | 'low' | null {
  if (s.permission !== 'granted' || s.mode !== 'device' || !s.device) return null
  if (!s.precise) return 'approximate'
  return s.accuracyM !== null && s.accuracyM > LOW_ACCURACY_M ? 'low' : null
}
