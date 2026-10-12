import { LngLatBounds, type MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect, useRef } from 'react'

import type { ShortageMap } from '@/api/admin-schemas'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

import { createMap, tokenColor } from './map-base'
import { RATE_STOPS } from './map-tokens'

/**
 * Carte des pénuries : polygones des cellules H3 res 7 (k ≥ 5, anonymat), couleur selon la part
 * des recherches sans station ouverte à 5 km, contour épais pour les zones en pénurie. Clic sur
 * une cellule → `onSelect`.
 */
export default function ShortagesHexMap({
  data,
  label,
  onSelect,
  selected,
  className,
}: {
  data: ShortageMap
  label: string
  onSelect: (cell: string | null) => void
  selected?: string | null
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<ReturnType<typeof createMap> | null>(null)
  const onSelectRef = useRef(onSelect)
  const { resolved } = useTheme()

  useEffect(() => {
    onSelectRef.current = onSelect
  })

  useEffect(() => {
    if (!ref.current) return
    const map = createMap(ref.current, resolved)
    mapRef.current = map
    const stops = RATE_STOPS.flatMap(([v, token, fallback]) => [v, tokenColor(token, fallback)])
    const outline = tokenColor('--foreground', '#0b0a09')
    map.on('load', () => {
      map.addSource('cells', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: data.features.map((f) => ({ ...f, properties: { ...f.properties } })),
        },
        promoteId: 'cell',
      })
      map.addLayer({
        id: 'cells-fill',
        type: 'fill',
        source: 'cells',
        paint: {
          'fill-color': ['interpolate', ['linear'], ['get', 'emptyRate'], ...stops] as never,
          'fill-opacity': 0.72,
        },
      })
      // Contours seulement de près (de loin, ils écraseraient le dégradé) ; la cellule choisie,
      // toujours.
      const selected = ['boolean', ['feature-state', 'selected'], false]
      map.addLayer({
        id: 'cells-line',
        type: 'line',
        source: 'cells',
        paint: {
          'line-color': outline,
          'line-opacity': ['case', selected, 1, ['get', 'shortage'], 0.6, 0.25] as never,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            7,
            ['case', selected, 2.5, 0],
            10,
            ['case', selected, 3, ['get', 'shortage'], 1.2, 0.4],
          ] as never,
        },
      })
      if (data.features.length > 0) {
        const b = new LngLatBounds()
        data.features.forEach((f) => f.geometry.coordinates[0]?.forEach((c) => b.extend(c as [number, number])))
        map.fitBounds(b, { padding: 48, maxZoom: 10, duration: 0 })
      }
      map.on('click', 'cells-fill', (e: MapLayerMouseEvent) => {
        onSelectRef.current((e.features?.[0]?.properties.cell as string | undefined) ?? null)
      })
      map.on('mouseenter', 'cells-fill', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'cells-fill', () => (map.getCanvas().style.cursor = ''))
    })
    return () => {
      mapRef.current = null
      map.remove()
    }
  }, [data, resolved])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !selected) return
    const apply = () => map.setFeatureState({ source: 'cells', id: selected }, { selected: true })
    if (map.getSource('cells')) apply()
    else map.once('load', apply)
    return () => {
      if (map.getSource('cells')) map.setFeatureState({ source: 'cells', id: selected }, { selected: false })
    }
  }, [selected])

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      className={cn('h-[min(70vh,640px)] w-full overflow-hidden rounded-xl border bg-muted', className)}
    />
  )
}
