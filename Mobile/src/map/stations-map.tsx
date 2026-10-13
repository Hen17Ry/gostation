import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec'
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  type GeoJSONSourceRef,
  Layer,
  Map,
  type MapRef,
  UserLocation,
} from '@maplibre/maplibre-react-native'
import { forwardRef, type ReactNode, useImperativeHandle, useMemo, useRef } from 'react'
import { type NativeSyntheticEvent } from 'react-native'

import type { SearchResult } from '@/api/schemas'
import { t } from '@/i18n'
import { bounds, type LatLng } from '@/lib/geo'
import { closedMarker } from '@/theme/illustration'
import { useTheme } from '@/theme/theme'

import { DEFAULT_CENTER, DEFAULT_ZOOM, MAX_BOUNDS, MAX_ZOOM, MIN_ZOOM, mapStyles } from './config'
import { clusterProperties, markerKey, markerOpen, markerRank } from './markers'

export interface StationsMapHandle {
  /** Cadre les résultats et le point de départ, au-dessus du panneau (padding bas). */
  fitResults: (results: SearchResult[], origin: LatLng | null, bottom: number) => void
  centerOn: (p: LatLng, opts?: { zoom?: number; bottom?: number }) => void
}

interface Props {
  results: SearchResult[]
  selectedId: string | null
  origin: LatLng | null
  /** Point choisi à la main (affiché comme une épingle). */
  manual: LatLng | null
  showUser: boolean
  onSelect: (id: string) => void
  /** Toucher la carte (hors marqueur) : choix du point de recherche si `picking`. */
  onPressMap?: (p: LatLng) => void
  onLongPressMap?: (p: LatLng) => void
  topInset: number
  children?: ReactNode
}

type Pressed = NativeSyntheticEvent<{ lngLat: [number, number]; features?: GeoJSON.Feature[] }>

/**
 * Carte des stations : style GoStation (clair/sombre), marqueurs regroupés (clusters calculés par
 * MapLibre en natif, pas de vue React par marqueur : 60 fps même avec beaucoup de résultats),
 * numéro de rang, station sélectionnée mise en avant, position de l'appareil (puce native).
 */
export const StationsMap = forwardRef<StationsMapHandle, Props>(function StationsMap(
  { results, selectedId, manual, showUser, onSelect, onPressMap, onLongPressMap, topInset, children },
  ref,
) {
  const { scheme, colors } = useTheme()
  const camera = useRef<CameraRef>(null)
  const map = useRef<MapRef>(null)
  const source = useRef<GeoJSONSourceRef>(null)

  useImperativeHandle(ref, () => ({
    fitResults(list, origin, bottom) {
      const pts = list.map((r) => r.station.location)
      if (origin) pts.push(origin)
      if (pts.length === 0) return
      if (pts.length === 1) {
        camera.current?.easeTo({
          center: [pts[0]!.lng, pts[0]!.lat],
          zoom: 14,
          padding: { bottom, top: topInset },
          duration: 500,
        })
        return
      }
      camera.current?.fitBounds(bounds(pts), {
        padding: { top: topInset + 48, bottom: bottom + 32, left: 48, right: 48 },
        duration: 600,
        easing: 'ease',
      })
    },
    centerOn(p, opts) {
      camera.current?.easeTo({
        center: [p.lng, p.lat],
        zoom: opts?.zoom ?? 13.5,
        padding: { bottom: opts?.bottom ?? 0, top: topInset },
        duration: 450,
      })
    },
  }))

  const stations = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: results.map((r, i) => ({
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: [r.station.location.lng, r.station.location.lat] },
        properties: { id: r.station.id, rank: i + 1, open: r.isOpen ? 1 : 0, key: markerKey(i + 1, r.isOpen) },
      })),
    }),
    [results],
  )

  const manualPoint = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: manual
        ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [manual.lng, manual.lat] }, properties: {} }]
        : [],
    }),
    [manual],
  )

  const onPressStations = async (e: Pressed) => {
    const f = e.nativeEvent.features?.[0]
    if (!f) return
    const props = f.properties ?? {}
    if (props.cluster) {
      const zoom = await source.current?.getClusterExpansionZoom(props.cluster_id as number).catch(() => undefined)
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number]
      camera.current?.easeTo({ center: [lng, lat], zoom: Math.min((zoom ?? 13) + 0.5, MAX_ZOOM), duration: 400 })
      return
    }
    if (typeof props.id === 'string') onSelect(props.id)
  }

  const ring = colors.surface
  const fill: ExpressionSpecification = ['case', markerOpen, colors.primary, closedMarker[scheme].fill]
  const stack = { 'circle-radius': 12, 'circle-color': fill, 'circle-stroke-width': 3, 'circle-stroke-color': ring }

  return (
    <Map
      ref={map}
      style={{ flex: 1 }}
      mapStyle={mapStyles[scheme]}
      accessibilityLabel={t.search.mapLabel}
      logo={false}
      compass={false}
      touchRotate={false}
      touchPitch={false}
      attribution
      attributionPosition={{ top: topInset + 4, right: 8 }}
      onPress={(e) => onPressMap?.({ lng: e.nativeEvent.lngLat[0], lat: e.nativeEvent.lngLat[1] })}
      onLongPress={(e) => onLongPressMap?.({ lng: e.nativeEvent.lngLat[0], lat: e.nativeEvent.lngLat[1] })}
    >
      <Camera
        ref={camera}
        initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }}
        maxBounds={MAX_BOUNDS}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
      />
      {/* Puce JS, redessinée après 10 m de déplacement seulement : la puce native, animée en
          continu, faisait tourner le rendu de la carte à 100 % d'un cœur, même hors écran. */}
      {showUser && <UserLocation animated={false} minDisplacement={10} />}

      <GeoJSONSource id="manual-origin" data={manualPoint}>
        <Layer
          id="manual-halo"
          type="circle"
          paint={{ 'circle-radius': 16, 'circle-color': colors.primary, 'circle-opacity': 0.2 }}
        />
        <Layer
          id="manual-dot"
          type="circle"
          paint={{
            'circle-radius': 7,
            'circle-color': colors.primary,
            'circle-stroke-width': 3,
            'circle-stroke-color': ring,
          }}
        />
      </GeoJSONSource>

      <GeoJSONSource
        id="stations"
        ref={source}
        data={stations}
        cluster
        clusterRadius={42}
        clusterMaxZoom={13}
        clusterProperties={clusterProperties}
        hitbox={{ top: 12, right: 12, bottom: 12, left: 12 }}
        onPress={onPressStations}
      >
        {/* Groupe : pastilles empilées derrière celle de sa meilleure station (cf. markers.ts). */}
        <Layer
          id="station-stack-far"
          type="circle"
          filter={['>=', ['get', 'point_count'], 3]}
          paint={{ ...stack, 'circle-translate': [10, -10] }}
        />
        <Layer
          id="station-stack"
          type="circle"
          filter={['has', 'point_count']}
          paint={{ ...stack, 'circle-translate': [5, -5] }}
        />
        <Layer
          id="station-selected"
          type="circle"
          filter={['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], selectedId ?? '']]}
          paint={{ 'circle-radius': 24, 'circle-color': colors.primary, 'circle-opacity': 0.22 }}
        />
        <Layer
          id="station"
          type="circle"
          paint={{
            'circle-color': fill,
            'circle-radius': ['case', ['==', ['get', 'id'], selectedId ?? ''], 15, 12],
            'circle-stroke-width': 3,
            'circle-stroke-color': ring,
          }}
        />
        <Layer
          id="station-rank"
          type="symbol"
          layout={{
            'text-field': markerRank,
            'text-font': ['Noto Sans Bold'],
            'text-size': 12,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          }}
          paint={{
            'text-color': ['case', markerOpen, colors['primary-foreground'], closedMarker[scheme].text],
          }}
        />
      </GeoJSONSource>
      {children}
    </Map>
  )
})
