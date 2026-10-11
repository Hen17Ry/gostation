import 'maplibre-gl/dist/maplibre-gl.css'

import { LngLatBounds, Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import { useEffect, useRef } from 'react'

import type { Dashboard } from '@/api/schemas'
import { t } from '@/i18n'
import { useTheme } from '@/lib/theme'

type Zone = Dashboard['shortages']['top'][number]

// Tuiles OpenFreeMap uniquement (CLAUDE.md, règle 6).
const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}
const BENIN_BOUNDS: [[number, number], [number, number]] = [
  [0.77, 6.2],
  [3.85, 12.42],
]

/**
 * Carte des zones en pénurie (centres des cellules H3 res 7). MapLibre est chargé à la demande :
 * ce module n'est importé qu'au clic sur « Afficher la carte ».
 */
export default function ShortagesMap({ zones }: { zones: Zone[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const { resolved } = useTheme()

  useEffect(() => {
    if (!ref.current) return
    const map = new MapLibreMap({
      container: ref.current,
      style: STYLES[resolved],
      bounds: BENIN_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
      cooperativeGestures: true,
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => {
      const brand = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#d14200'
      map.addSource('zones', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: zones.map((z) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [z.center.lng, z.center.lat] },
            properties: { searches: z.searches, rate: z.emptyRate },
          })),
        },
      })
      map.addLayer({
        id: 'zones',
        type: 'circle',
        source: 'zones',
        paint: {
          'circle-color': brand,
          'circle-opacity': ['interpolate', ['linear'], ['get', 'rate'], 0.5, 0.45, 1, 0.85],
          'circle-radius': ['interpolate', ['linear'], ['get', 'searches'], 5, 6, 500, 18],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      })
      if (zones.length > 0) {
        const b = new LngLatBounds()
        zones.forEach((z) => b.extend([z.center.lng, z.center.lat]))
        map.fitBounds(b, { padding: 48, maxZoom: 9, duration: 0 })
      }
    })
    return () => map.remove()
  }, [zones, resolved])

  return (
    <div
      ref={ref}
      role="region"
      aria-label={t.dashboard.mapLabel}
      className="h-72 w-full overflow-hidden rounded-lg border"
    />
  )
}
