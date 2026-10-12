import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  NativeUserLocation,
  UserLocation,
} from '@maplibre/maplibre-react-native'
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'

import { t } from '@/i18n'
import { bounds, type LatLng } from '@/lib/geo'
import { DEFAULT_ZOOM, MAX_BOUNDS, MAX_ZOOM, MIN_ZOOM, mapStyles } from '@/map/config'
import { useTheme } from '@/theme/theme'

export interface RouteMapHandle {
  fit: (points: LatLng[], padding: { top: number; bottom: number }) => void
}

/**
 * Carte de l'itinéraire : tracé (liseré + trait orange ; pointillés pour la ligne droite de
 * secours), départ et station. En navigation, la caméra suit la position et le cap (natif).
 */
export const RouteMap = forwardRef<
  RouteMapHandle,
  {
    line: LatLng[]
    dashed?: boolean
    station: LatLng
    origin: LatLng | null
    showUser: boolean
    follow: boolean
    topInset: number
  }
>(function RouteMap({ line, dashed = false, station, origin, showUser, follow, topInset }, ref) {
  const { colors, scheme } = useTheme()
  const camera = useRef<CameraRef>(null)

  useImperativeHandle(ref, () => ({
    fit(points, padding) {
      if (points.length === 0) return
      camera.current?.fitBounds(bounds(points), {
        padding: { top: padding.top + 24, bottom: padding.bottom + 24, left: 40, right: 40 },
        duration: 600,
        easing: 'ease',
      })
    },
  }))

  const routeData = useMemo<GeoJSON.Feature>(
    () => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: line.map((p) => [p.lng, p.lat]) },
    }),
    [line],
  )
  const points = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { kind: 'station' },
          geometry: { type: 'Point', coordinates: [station.lng, station.lat] },
        },
        ...(origin && !showUser
          ? [
              {
                type: 'Feature' as const,
                properties: { kind: 'origin' },
                geometry: { type: 'Point' as const, coordinates: [origin.lng, origin.lat] },
              },
            ]
          : []),
      ],
    }),
    [station, origin, showUser],
  )

  return (
    <Map
      style={{ flex: 1 }}
      mapStyle={mapStyles[scheme]}
      accessibilityLabel={t.route.title}
      logo={false}
      compass={follow}
      compassPosition={{ top: topInset + 140, right: 12 }}
      touchRotate={follow}
      touchPitch={false}
      attributionPosition={{ top: topInset + 4, right: 8 }}
    >
      <Camera
        ref={camera}
        initialViewState={{ center: [station.lng, station.lat], zoom: DEFAULT_ZOOM }}
        maxBounds={MAX_BOUNDS}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        {...(follow
          ? {
              trackUserLocation: 'course' as const,
              zoom: 16.5,
              pitch: 45,
              padding: { top: topInset + 120, bottom: 160 },
            }
          : {})}
      />
      {/* Navigation : puce native (cap, suivi de la caméra) ; aperçu : puce JS, sans rendu continu. */}
      {showUser &&
        (follow ? <NativeUserLocation mode="course" /> : <UserLocation animated={false} minDisplacement={10} />)}
      {line.length > 1 && (
        <GeoJSONSource id="route" data={routeData}>
          <Layer
            id="route-casing"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': colors['primary-hover'],
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 12],
              'line-opacity': dashed ? 0 : 0.9,
            }}
          />
          <Layer
            id="route-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': colors.primary,
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 8],
              ...(dashed ? { 'line-dasharray': [1.5, 1.5] } : {}),
            }}
          />
        </GeoJSONSource>
      )}
      <GeoJSONSource id="route-points" data={points}>
        <Layer
          id="route-origin"
          type="circle"
          filter={['==', ['get', 'kind'], 'origin']}
          paint={{
            'circle-radius': 7,
            'circle-color': colors.info,
            'circle-stroke-width': 3,
            'circle-stroke-color': colors.surface,
          }}
        />
        <Layer
          id="route-station-halo"
          type="circle"
          filter={['==', ['get', 'kind'], 'station']}
          paint={{ 'circle-radius': 20, 'circle-color': colors.primary, 'circle-opacity': 0.2 }}
        />
        <Layer
          id="route-station"
          type="circle"
          filter={['==', ['get', 'kind'], 'station']}
          paint={{
            'circle-radius': 11,
            'circle-color': colors.primary,
            'circle-stroke-width': 3,
            'circle-stroke-color': colors.surface,
          }}
        />
      </GeoJSONSource>
    </Map>
  )
})
