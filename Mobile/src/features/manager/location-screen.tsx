import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  type MapRef,
  UserLocation,
} from '@maplibre/maplibre-react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { ArrowLeft, LocateFixed, MapPin, TriangleAlert } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { isApiError } from '@/api/errors'
import { invalidateOtherVersions, isVersionConflict, managerStationQuery, setStationLocation } from '@/api/manager'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Text } from '@/components/ui/text'
import { toast } from '@/components/ui/toast'
import { useLocation } from '@/features/location/location-store'
import { t } from '@/i18n'
import { formatDistance } from '@/lib/format'
import type { LatLng } from '@/lib/geo'
import { haptics } from '@/lib/haptics'
import { MapAttribution } from '@/map/attribution'
import { DEFAULT_CENTER, MAX_BOUNDS, MAX_ZOOM, MIN_ZOOM, mapStyles } from '@/map/config'
import { elevation } from '@/theme/elevation'
import { useTheme } from '@/theme/theme'

const PIN_SIZE = 48
const ZOOM = 17

/**
 * Épinglage de la station (D13, D64) : carte plein écran, épingle fixe au centre (on déplace la
 * carte dessous, aucun travail JS pendant le geste), avertissement toujours visible. La position
 * et la précision du téléphone partent avec la requête, jamais stockées. Plus de 200 m : demande
 * de déplacement en attente, l'ancienne position restant active.
 */
export function LocationScreen() {
  const qc = useQueryClient()
  const insets = useSafeAreaInsets()
  const { scheme, colors } = useTheme()
  const station = useQuery(managerStationQuery)
  const map = useRef<MapRef>(null)
  const camera = useRef<CameraRef>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [panelH, setPanelH] = useState(0)
  const [fallback, setStart] = useState<LatLng | null>(null)
  const permission = useLocation((s) => s.permission)
  const s = station.data?.data
  // Point de départ : la position active de la station, sinon celle du téléphone (D64).
  const start = s?.location ?? fallback

  useEffect(() => {
    if (fallback || !station.data || station.data.data.location) return
    void (async () => {
      await useLocation.getState().refreshPermission()
      const p = await useLocation.getState().locate({ interactive: true })
      setStart(p ?? { lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1] })
      if (!p) setError(t.manager.location.noDevice)
    })()
  }, [station.data, fallback])

  const markers: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      ...(s?.location
        ? [
            {
              type: 'Feature' as const,
              properties: { kind: 'active' },
              geometry: { type: 'Point' as const, coordinates: [s.location.lng, s.location.lat] },
            },
          ]
        : []),
      ...(s?.pendingMove
        ? [
            {
              type: 'Feature' as const,
              properties: { kind: 'pending' },
              geometry: {
                type: 'Point' as const,
                coordinates: [s.pendingMove.location.lng, s.pendingMove.location.lat],
              },
            },
          ]
        : []),
    ],
  }

  const recenter = async () => {
    const p = await useLocation.getState().locate({ interactive: true })
    if (p) camera.current?.easeTo({ center: [p.lng, p.lat], zoom: ZOOM, duration: 400 })
    else setError(t.manager.location.noDevice)
  }

  const place = async (retried = false) => {
    if (!station.data || !map.current) return
    setBusy(true)
    setError(null)
    try {
      const [lng, lat] = await map.current.getCenter()
      // Position du téléphone lue au moment de l'envoi, pour la requête seulement (règle 2).
      const device = permission === 'granted' ? await useLocation.getState().locate() : null
      const accuracyM = useLocation.getState().accuracyM
      const res = await setStationLocation(
        {
          lat,
          lng,
          confirmStationLocation: true,
          ...(device
            ? { device: { lat: device.lat, lng: device.lng, accuracyM: Math.min(10_000, accuracyM ?? 50) } }
            : {}),
        },
        station.data.etag,
      )
      qc.setQueryData(managerStationQuery.queryKey, { data: res.data.station, etag: res.etag })
      void invalidateOtherVersions(qc, managerStationQuery.queryKey)
      haptics.success()
      if (res.data.outcome === 'move_requested') toast.info(t.manager.location.moveRequested)
      else toast.success(res.data.outcome === 'corrected' ? t.manager.location.corrected : t.manager.location.saved)
      if (res.data.flagged) toast.info(t.manager.location.flagged)
      router.back()
    } catch (e) {
      if (isVersionConflict(e) && !retried) {
        // Seul le gérant déplace sa station : on rejoue avec la version à jour.
        await qc.fetchQuery({ ...managerStationQuery, staleTime: 0 }).catch(() => null)
        setBusy(false)
        return place(true)
      }
      haptics.error()
      setError(
        isApiError(e) && e.code === 'station.location_outside_country'
          ? t.manager.location.outside
          : isApiError(e)
            ? e.userMessage
            : t.common.errorTitle,
      )
    } finally {
      setBusy(false)
    }
  }

  // Centre de l'épingle : milieu de la zone visible entre l'avertissement et le panneau du bas.
  return (
    <View className="flex-1 bg-background">
      {start && (
        <Map
          ref={map}
          style={{ flex: 1 }}
          mapStyle={mapStyles[scheme]}
          accessibilityLabel={t.manager.location.title}
          logo={false}
          compass={false}
          attribution={false}
          touchRotate={false}
          touchPitch={false}
        >
          <Camera
            ref={camera}
            initialViewState={{ center: [start.lng, start.lat], zoom: ZOOM }}
            maxBounds={MAX_BOUNDS}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
          />
          {permission === 'granted' && <UserLocation animated={false} minDisplacement={5} />}
          <GeoJSONSource id="station-points" data={markers}>
            <Layer
              id="station-active"
              type="circle"
              filter={['==', ['get', 'kind'], 'active']}
              paint={{
                'circle-radius': 8,
                'circle-color': colors['muted-foreground'],
                'circle-stroke-width': 3,
                'circle-stroke-color': colors.surface,
              }}
            />
            <Layer
              id="station-pending"
              type="circle"
              filter={['==', ['get', 'kind'], 'pending']}
              paint={{
                'circle-radius': 8,
                'circle-color': colors.surface,
                'circle-stroke-width': 3,
                'circle-stroke-color': colors.primary,
              }}
            />
          </GeoJSONSource>
        </Map>
      )}

      {/* Épingle fixe : sa pointe est exactement au centre de la carte. */}
      <View
        pointerEvents="none"
        accessible
        accessibilityLabel={t.manager.location.pinLabel}
        className="absolute inset-0 items-center justify-center"
      >
        <View style={{ transform: [{ translateY: -PIN_SIZE / 2 }] }}>
          <MapPin size={PIN_SIZE} color={colors.primary} fill={colors.primary} strokeWidth={1.6} />
        </View>
        <View className="absolute h-2 w-2 rounded-full bg-foreground" />
      </View>

      <View
        pointerEvents="box-none"
        className="absolute inset-x-0 top-0 gap-3 px-4"
        style={{ paddingTop: insets.top + 8 }}
      >
        <View pointerEvents="box-none" className="flex-row items-start gap-3">
          <IconButton floating icon={ArrowLeft} label={t.common.back} onPress={() => router.back()} />
          <View
            testID="location-warning"
            className="flex-1 gap-1 rounded-xl border border-warning-subtle bg-popover p-3"
            style={elevation(2)}
            accessibilityRole="alert"
          >
            <View className="flex-row items-center gap-2">
              <TriangleAlert size={18} color={colors['warning-subtle-foreground']} />
              <Text variant="subhead" weight="bold" className="flex-1">
                {t.manager.location.warning}
              </Text>
            </View>
            <Text variant="footnote" tone="muted">
              {t.manager.location.advice}
            </Text>
          </View>
        </View>
      </View>

      {panelH > 0 && (
        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 flex-row items-end justify-between px-4"
          style={{ bottom: panelH + 4 }}
        >
          <MapAttribution />
          {permission === 'granted' && (
            <View className="pb-2">
              <IconButton
                floating
                icon={LocateFixed}
                label={t.manager.location.recenter}
                tone="brand"
                onPress={recenter}
              />
            </View>
          )}
        </View>
      )}

      <View
        className="absolute inset-x-0 bottom-0 gap-3 rounded-t-3xl border-t border-border bg-surface px-5 pt-4"
        style={[elevation(3), { paddingBottom: Math.max(insets.bottom, 12) }]}
        onLayout={(e) => setPanelH(e.nativeEvent.layout.height)}
      >
        <Text variant="title3" accessibilityRole="header">
          {t.manager.location.title}
        </Text>
        {s?.pendingMove && (
          <Banner tone="info" title={t.manager.location.pending}>
            {t.manager.location.pendingBody(formatDistance(s.pendingMove.distanceM))}
          </Banner>
        )}
        {error && (
          <Banner tone="danger" className="">
            {error}
          </Banner>
        )}
        <Button
          testID="location-confirm"
          label={t.manager.location.confirm}
          icon={MapPin}
          size="lg"
          loading={busy}
          disabled={!start || !station.data}
          onPress={() => place()}
        />
      </View>
    </View>
  )
}
