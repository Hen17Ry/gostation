import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect, useRef } from 'react'

import type { StationMap } from '@/api/admin-schemas'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

import { createMap, tokenColor } from './map-base'
import { CATEGORY_TOKENS, mapCategory } from './map-tokens'

/**
 * Carte de toutes les stations épinglées : regroupement des marqueurs (clusters MapLibre),
 * couleur par statut et fraîcheur, clic sur une station → `onSelect`, clic sur un groupe → zoom.
 */
export default function StationsMap({
  data,
  label,
  onSelect,
  selectedId,
  className,
}: {
  data: StationMap
  label: string
  onSelect: (id: string) => void
  selectedId?: string
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
    const colors = Object.fromEntries(
      Object.entries(CATEGORY_TOKENS).map(([k, [token, fallback]]) => [k, tokenColor(token, fallback)]),
    )
    const surface = tokenColor('--card', '#ffffff')
    const brand = tokenColor('--primary', '#d14200')
    const ink = tokenColor('--primary-foreground', '#ffffff')
    map.on('load', () => {
      map.addSource('stations', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: data.features.map((f) => ({
            type: 'Feature',
            id: f.id,
            geometry: { type: 'Point', coordinates: f.geometry.coordinates },
            properties: { id: f.id, name: f.properties.name, category: mapCategory(f.properties) },
          })),
        },
        cluster: true,
        clusterRadius: 44,
        clusterMaxZoom: 13,
        promoteId: 'id',
      })
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'stations',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': brand,
          'circle-opacity': 0.9,
          'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 23, 500, 28],
          'circle-stroke-color': surface,
          'circle-stroke-width': 2,
        },
      })
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'stations',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 12,
          'text-font': ['Noto Sans Bold'],
        },
        paint: { 'text-color': ink },
      })
      map.addLayer({
        id: 'station',
        type: 'circle',
        source: 'stations',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['match', ['get', 'category'], ...Object.entries(colors).flat(), brand] as never,
          'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 9, 6],
          'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], brand, surface],
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 1.5],
        },
      })
      map.on('click', 'clusters', (e: MapLayerMouseEvent) => {
        const f = e.features?.[0]
        if (!f) return
        const source = map.getSource('stations') as GeoJSONSource
        void source.getClusterExpansionZoom(f.properties.cluster_id as number).then((zoom) => {
          map.easeTo({ center: (f.geometry as { coordinates: [number, number] }).coordinates, zoom })
        })
      })
      map.on('click', 'station', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties.id as string | undefined
        if (id) onSelectRef.current(id)
      })
      for (const layer of ['clusters', 'station']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
      }
    })
    return () => {
      mapRef.current = null
      map.remove()
    }
  }, [data, resolved])

  // Station sélectionnée : état de la feature (rayon et liseré), sans recréer la carte.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedId) return
    const apply = () => map.setFeatureState({ source: 'stations', id: selectedId }, { selected: true })
    if (map.getSource('stations')) apply()
    else map.once('load', apply)
    return () => {
      if (map.getSource('stations')) map.setFeatureState({ source: 'stations', id: selectedId }, { selected: false })
    }
  }, [selectedId])

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      className={cn('h-[min(70vh,640px)] w-full overflow-hidden rounded-xl border bg-muted', className)}
    />
  )
}
