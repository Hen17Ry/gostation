import { OfflineManager, type StyleSpecification } from '@maplibre/maplibre-react-native'

import dark from './styles/dark.json'
import light from './styles/light.json'

/** Styles OpenFreeMap recolorés (scripts/gen-map-styles.mts), sans sprite ni raster. */
export const mapStyles = {
  light: light as unknown as StyleSpecification,
  dark: dark as unknown as StyleSpecification,
}

/** Cotonou : vue initiale sans position. */
export const DEFAULT_CENTER: [number, number] = [2.4183, 6.3654]
export const DEFAULT_ZOOM = 11.5

/**
 * Emprise navigable : le Bénin et ses abords (zone couverte + 30 km, avec marge). Limiter la
 * caméra évite de télécharger des tuiles inutiles.
 */
export const MAX_BOUNDS: [number, number, number, number] = [-0.6, 5.4, 5.2, 13.4]
export const MIN_ZOOM = 5.5
export const MAX_ZOOM = 18

/** Cache ambiant des tuiles (MapLibre) : 80 Mo, réutilisé entre les sessions, hors ligne compris. */
const AMBIENT_CACHE_BYTES = 80 * 1024 * 1024

let configured = false
export function configureMapCache() {
  if (configured) return
  configured = true
  void OfflineManager.setMaximumAmbientCacheSize(AMBIENT_CACHE_BYTES).catch(() => undefined)
}
