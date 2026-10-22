import { Platform } from 'react-native'

import nativeLocation, { type GoStationLocationModule } from '../../modules/gostation-location'

/**
 * Google Play Services : absents de beaucoup de téléphones au Bénin (Huawei récents). Sans eux, le
 * fused provider (position) et FCM (push) ne fonctionnent pas ; tout le code mobile doit marcher
 * quand même (position : `features/location/provider`, push : `features/notifications/availability`).
 */

/**
 * Services présents et utilisables (absents, désactivés ou trop anciens : faux). Hors Android : vrai
 * (sans objet). Module local absent : vrai, le comportement d'avant est gardé.
 */
export function detectPlayServices(
  os: string = Platform.OS,
  native: Pick<GoStationLocationModule, 'hasGooglePlayServices'> | null = nativeLocation,
): boolean {
  if (os !== 'android' || !native) return true
  try {
    return native.hasGooglePlayServices()
  } catch {
    return false
  }
}

let cached: boolean | null = null

/** Détection faite une fois, au premier usage (démarrage). */
export function hasPlayServices(): boolean {
  cached ??= detectPlayServices()
  return cached
}
