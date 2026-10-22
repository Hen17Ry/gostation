import { requireOptionalNativeModule } from 'expo'

/**
 * Module natif local (Android seulement) : détection de Google Play Services et position par le
 * LocationManager d'Android (GPS et réseau), sans les services de Google ni ceux de Huawei.
 * Absent sur iOS et sous Jest : `null`.
 */
export interface NativeFix {
  latitude: number
  longitude: number
  accuracy: number | null
  altitude: number | null
  speed: number | null
  heading: number | null
  /** Heure de la mesure (ms depuis l'epoch). */
  timestamp: number
  provider: string | null
}

export interface ProviderStatus {
  locationEnabled: boolean
  gps: boolean
  network: boolean
}

export interface GoStationLocationModule {
  hasGooglePlayServices(): boolean
  getProviderStatus(): ProviderStatus
  getLastKnownPosition(maxAgeMs: number): Promise<NativeFix | null>
  getCurrentPosition(options: { timeoutMs: number; goodAccuracyM: number; settleMs: number }): Promise<NativeFix>
  startWatching(id: number, options: { intervalMs: number; distanceM: number }): void
  stopWatching(id: number): void
  addListener(event: 'onLocation', listener: (e: { watchId: number; location: NativeFix }) => void): { remove(): void }
}

export default requireOptionalNativeModule<GoStationLocationModule>('GoStationLocation')
