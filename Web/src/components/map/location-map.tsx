import { LngLatBounds, Marker } from 'maplibre-gl'
import { useEffect, useRef } from 'react'

import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

import { createMap, pinElement, tokenColor } from './map-base'

export interface MapPoint {
  lat: number
  lng: number
  label: string
  variant?: 'primary' | 'muted' | 'info'
}

/**
 * Carte d'une ou deux positions (fiche station : épingle ; demande de déplacement : avant et
 * après, reliées par un trait). Chargée à la demande avec MapLibre.
 */
export default function LocationMap({
  points,
  label,
  className,
  connect = false,
}: {
  points: MapPoint[]
  label: string
  className?: string
  connect?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { resolved } = useTheme()
  const key = points.map((p) => `${p.lat},${p.lng},${p.variant}`).join('|')

  useEffect(() => {
    if (!ref.current || points.length === 0) return
    const first = points[0]!
    const map = createMap(ref.current, resolved, {
      bounds: undefined,
      center: [first.lng, first.lat],
      zoom: 15,
    })
    const markers = points.map((p) =>
      new Marker({ element: pinElement(p.label, p.variant), anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map),
    )
    if (points.length > 1) {
      const b = new LngLatBounds()
      points.forEach((p) => b.extend([p.lng, p.lat]))
      map.fitBounds(b, { padding: 64, maxZoom: 16, duration: 0 })
    }
    if (connect && points.length > 1) {
      map.on('load', () => {
        map.addSource('link', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) },
          },
        })
        map.addLayer({
          id: 'link',
          type: 'line',
          source: 'link',
          paint: {
            'line-color': tokenColor('--brand-text', '#b13505'),
            'line-width': 2,
            'line-dasharray': [2, 2],
          },
        })
      })
    }
    return () => {
      markers.forEach((m) => m.remove())
      map.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` résume les points
  }, [key, resolved, connect])

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      className={cn('h-64 w-full overflow-hidden rounded-lg border bg-muted', className)}
    />
  )
}
