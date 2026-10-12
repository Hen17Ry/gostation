import 'maplibre-gl/dist/maplibre-gl.css'

import { Map as MapLibreMap, type MapOptions, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

import { parseColor, toHex } from '@/lib/color'

// Tuiles OpenFreeMap uniquement (CLAUDE.md, règle 6).
export const MAP_STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const

export const BENIN_BOUNDS: [[number, number], [number, number]] = [
  [0.77, 6.2],
  [3.85, 12.42],
]

/**
 * Couleur d'un token CSS au format compris par MapLibre (hex) : les tokens sont en oklch, que le
 * moteur de style de MapLibre ne lit pas.
 */
export function tokenColor(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const c = raw ? parseColor(raw) : null
  return c ? toHex(c) : fallback
}

// MapLibre 6 cherche son worker à côté de son propre module : introuvable une fois bundlé par
// Vite. On lui donne l'URL du fichier copié tel quel dans le build (même origine, CSP inchangée).
setWorkerUrl(workerUrl)

/** Crée une carte MapLibre aux réglages communs (Bénin, attribution compacte, zoom +/−). */
export function createMap(
  container: HTMLElement,
  theme: 'light' | 'dark',
  options: Partial<MapOptions> = {},
): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style: MAP_STYLES[theme],
    bounds: BENIN_BOUNDS,
    fitBoundsOptions: { padding: 24 },
    attributionControl: { compact: true },
    cooperativeGestures: true,
    ...options,
  })
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
  return map
}

/** Élément d'une épingle (marqueur HTML aux tokens) ; `label` est lu par les lecteurs d'écran. */
export function pinElement(label: string, variant: 'primary' | 'muted' | 'info' = 'primary'): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', label)
  el.className = 'gs-pin'
  el.dataset.variant = variant
  el.innerHTML =
    '<svg viewBox="0 0 24 32" width="28" height="36" aria-hidden="true"><path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0Z"/><circle cx="12" cy="12" r="4.5"/></svg>'
  return el
}
