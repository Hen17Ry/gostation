import { useMutation, useQuery } from '@tanstack/react-query'
import { useKeepAwake } from 'expo-keep-awake'
import { router, useLocalSearchParams } from 'expo-router'
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  ExternalLink,
  Flag,
  type LucideIcon,
  Navigation,
  RotateCcw,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { type ApiError, isApiError } from '@/api/errors'
import { fetchRoute, stationQuery } from '@/api/public'
import type { Route } from '@/api/schemas'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Text } from '@/components/ui/text'
import { LOW_ACCURACY_M, searchOrigin, useLocation } from '@/features/location/location-store'
import { openExternalNavigation } from '@/features/navigation/external'
import { departBearing, instructionText, type ManeuverIcon, maneuverIcon } from '@/features/navigation/instructions'
import { guidance as computeGuidance, prepareRoute, type PreparedRoute } from '@/features/navigation/progress'
import { RouteMap, type RouteMapHandle } from '@/features/navigation/route-map'
import { MapAttribution } from '@/map/attribution'
import { bannerDistance, useGuidance } from '@/features/navigation/use-guidance'
import { t } from '@/i18n'
import { formatDistance, formatDuration, formatTime } from '@/lib/format'
import { distanceM, type LatLng } from '@/lib/geo'
import { AnimatedView } from '@/lib/animated'
import { haptics } from '@/lib/haptics'
import { useNow } from '@/lib/use-now'
import { usePrefs } from '@/stores/prefs'
import { elevation } from '@/theme/elevation'
import { useTheme } from '@/theme/theme'

const ICONS: Record<ManeuverIcon, LucideIcon> = {
  depart: Navigation,
  arrive: Flag,
  straight: ArrowUp,
  left: CornerUpLeft,
  right: CornerUpRight,
  'slight-left': ArrowUpLeft,
  'slight-right': ArrowUpRight,
  'sharp-left': CornerUpLeft,
  'sharp-right': CornerUpRight,
  uturn: Undo2,
  roundabout: RotateCcw,
}

type Phase = 'loading' | 'preview' | 'navigating' | 'arrived' | 'fallback' | 'error' | 'no-origin'

/**
 * Itinéraire vers une station : aperçu (durée, distance, heure d'arrivée), puis mode navigation
 * (suivi, bandeau de manœuvre en français, distance restante et heure d'arrivée, recalcul, écran
 * allumé, voix facultative). 503 : ligne droite + ouverture dans une autre app.
 */
export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const station = useQuery(stationQuery(id))
  const loc = useLocation()
  const origin = useMemo(() => searchOrigin(loc), [loc])
  const voice = usePrefs((s) => s.voice)
  const setVoice = usePrefs((s) => s.setVoice)
  const map = useRef<RouteMapHandle>(null)
  const [mode, setMode] = useState<'preview' | 'navigating' | 'arrived'>('preview')
  const [rerouted, setRerouted] = useState<Route | null>(null)
  const [bottomH, setBottomH] = useState(220)

  const dest = station.data?.location ?? null
  const name = station.data?.name ?? ''

  // Itinéraire en mémoire seulement (mutation : pas de cache indexé par la position, règle 2).
  const request = useMutation({
    mutationFn: (from: LatLng) => fetchRoute(from, id),
    onMutate: () => setRerouted(null),
  })
  const load = (from: LatLng | null) => {
    if (from) request.mutate(from)
  }

  useEffect(() => {
    if (station.data && origin) request.mutate(origin)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- au chargement de la station
  }, [station.data?.id])

  const routeData = rerouted ?? request.data ?? null
  const prepared = useMemo<PreparedRoute | null>(() => (routeData ? prepareRoute(routeData) : null), [routeData])
  const error: ApiError | null = isApiError(request.error) ? request.error : null
  const phase: Phase =
    !origin && !routeData
      ? 'no-origin'
      : request.isError
        ? error?.code === 'routing.unavailable' || error?.isNetwork
          ? 'fallback'
          : 'error'
        : !prepared
          ? 'loading'
          : mode

  // Cadrage du trajet (ou de la ligne droite) au-dessus du panneau du bas.
  const line = useMemo<LatLng[]>(() => {
    if (prepared && phase !== 'fallback') return prepared.line
    if (origin && dest) return [origin, dest]
    return []
  }, [prepared, phase, origin, dest])
  useEffect(() => {
    if (phase === 'preview' || phase === 'fallback') map.current?.fit(line, { top: insets.top + 64, bottom: bottomH })
  }, [phase, line, insets.top, bottomH])

  const guidance = useGuidance({
    active: phase === 'navigating',
    prepared,
    destination: dest ?? { lat: 0, lng: 0 },
    destinationName: name,
    voice,
    reroute: async (from) => {
      try {
        setRerouted(await fetchRoute(from, id))
        return true
      } catch {
        return false
      }
    },
    onArrive: () => {
      haptics.success()
      setMode('arrived')
    },
  })

  // Avant la première mesure GPS du guidage : état calculé depuis le départ du tracé.
  const live = useMemo(
    () =>
      guidance.state ??
      (phase === 'navigating' && prepared && dest ? computeGuidance(prepared, prepared.line[0] ?? dest, dest) : null),
    [guidance.state, phase, prepared, dest],
  )

  const start = async () => {
    if (loc.permission !== 'granted') {
      const permission = await loc.requestPermission()
      if (permission !== 'granted') return
    }
    haptics.light()
    // Départ depuis la position réelle (l'aperçu a pu partir d'un point choisi sur la carte).
    const here = await loc.locate()
    if (here && origin && distanceM(here, origin) > 100) await request.mutateAsync(here).catch(() => undefined)
    if (here) useLocation.getState().useDevice()
    setMode('navigating')
  }

  if (!station.data) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <Skeleton height="100%" className="rounded-none" />
      </View>
    )
  }

  const navigating = phase === 'navigating'
  return (
    <View className="flex-1 bg-background">
      {dest && (
        <RouteMap
          ref={map}
          line={line}
          dashed={phase === 'fallback'}
          station={dest}
          origin={origin}
          showUser={loc.permission === 'granted'}
          follow={navigating}
          topInset={insets.top}
        />
      )}

      {navigating && prepared && live ? (
        <ManeuverBanner
          prepared={prepared}
          stepIndex={live.stepIndex}
          toManeuverM={live.toManeuverM}
          top={insets.top}
          rerouting={guidance.rerouting}
        />
      ) : (
        <View className="absolute left-4" style={{ top: insets.top + 8 }}>
          <IconButton floating icon={ArrowLeft} label={t.common.back} onPress={() => router.back()} />
        </View>
      )}

      {dest && bottomH > 0 && (
        <View pointerEvents="box-none" className="absolute left-4" style={{ bottom: bottomH }}>
          <MapAttribution />
        </View>
      )}

      <View className="absolute inset-x-0 bottom-0" onLayout={(e) => setBottomH(e.nativeEvent.layout.height)}>
        <AnimatedView
          entering={FadeInDown.duration(220)}
          className="mx-3 gap-3 rounded-3xl border border-border bg-popover p-4"
          style={[elevation(3), { marginBottom: Math.max(insets.bottom, 12) }]}
        >
          {phase === 'loading' && <Loading />}
          {phase === 'no-origin' && (
            <>
              <Banner tone="info">{t.route.needLocation}</Banner>
              <Button
                label={t.onboarding.allowLocation}
                size="lg"
                onPress={async () => {
                  if ((await loc.requestPermission()) === 'granted') void load(await loc.locate())
                }}
              />
            </>
          )}
          {phase === 'error' && (
            <>
              <Banner tone="danger">
                {error?.code === 'search.out_of_coverage'
                  ? t.route.outOfCoverage
                  : (error?.userMessage ?? t.common.errorTitle)}
              </Banner>
              <Button label={t.common.retry} variant="outline" onPress={() => load(origin)} />
            </>
          )}
          {phase === 'fallback' && dest && (
            <>
              <StationTitle
                name={name}
                subtitle={origin ? t.route.straightLine(formatDistance(distanceM(origin, dest))) : undefined}
              />
              <Banner tone="warning" title={t.route.unavailable}>
                {t.route.unavailableBody}
              </Banner>
              {/* L'un sous l'autre : « Ouvrir dans une autre app » ne doit pas être tronqué. */}
              <View className="gap-3">
                <Button
                  testID="route-external"
                  label={t.route.openExternal}
                  icon={ExternalLink}
                  onPress={() => void openExternalNavigation(dest, name)}
                />
                <Button label={t.common.retry} variant="outline" onPress={() => load(origin)} />
              </View>
            </>
          )}
          {phase === 'preview' && prepared && (
            <Preview prepared={prepared} name={name} voice={voice} onVoice={() => setVoice(!voice)} onStart={start} />
          )}
          {navigating && guidance.accuracyM !== null && guidance.accuracyM > LOW_ACCURACY_M && (
            <Banner tone="warning">
              {loc.precise ? t.route.weakSignal(formatDistance(guidance.accuracyM)) : t.route.weakSignalApproximate}
            </Banner>
          )}
          {navigating && prepared && (
            <NavigationPanel
              remainingM={live?.remainingM ?? prepared.totalM}
              remainingS={live?.remainingS ?? prepared.route.durationS}
              voice={voice}
              onVoice={() => setVoice(!voice)}
              onStop={() => {
                haptics.light()
                setMode('preview')
              }}
            />
          )}
          {phase === 'arrived' && (
            <AnimatedView entering={FadeIn} className="gap-3">
              <View className="flex-row items-center gap-3">
                <View className="h-12 w-12 items-center justify-center rounded-full bg-success-subtle">
                  <Flag size={24} color={colors['success-subtle-foreground']} />
                </View>
                <View className="flex-1">
                  <Text variant="title3" accessibilityRole="header" accessibilityLiveRegion="assertive">
                    {t.route.arrived}
                  </Text>
                  <Text variant="subhead" tone="muted">
                    {t.route.arrivedBody(name)}
                  </Text>
                </View>
              </View>
              <Button label={t.route.stop} size="lg" onPress={() => router.back()} />
            </AnimatedView>
          )}
        </AnimatedView>
      </View>
      {navigating && <KeepAwake />}
    </View>
  )
}

/** Écran allumé pendant le guidage seulement. */
function KeepAwake() {
  useKeepAwake('gostation-navigation')
  return null
}

function Loading() {
  const { colors } = useTheme()
  return (
    <View className="flex-row items-center gap-3 py-2" accessible accessibilityLabel={t.common.loading}>
      <Spinner color={colors.primary} />
      <View className="flex-1 gap-2">
        <Skeleton height={20} width="60%" />
        <Skeleton height={14} width="40%" />
      </View>
    </View>
  )
}

function StationTitle({ name, subtitle }: { name: string; subtitle?: string }) {
  return (
    <View className="gap-0.5">
      <Text variant="title3" numberOfLines={1} accessibilityRole="header">
        {name}
      </Text>
      {subtitle && (
        <Text variant="subhead" tone="muted">
          {subtitle}
        </Text>
      )}
    </View>
  )
}

function Preview({
  prepared,
  name,
  voice,
  onVoice,
  onStart,
}: {
  prepared: PreparedRoute
  name: string
  voice: boolean
  onVoice: () => void
  onStart: () => void
}) {
  const r: Route = prepared.route
  const now = useNow()
  const arrival = formatTime(new Date(now + r.durationS * 1000))
  return (
    <>
      <View className="flex-row items-end justify-between gap-3">
        <View className="flex-1 gap-0.5">
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {name}
          </Text>
          <Text variant="title1" accessibilityLabel={`${formatDuration(r.durationS)}, ${formatDistance(r.distanceM)}`}>
            {formatDuration(r.durationS)}
            <Text variant="title3" tone="muted" weight="medium">
              {`  ${formatDistance(r.distanceM)}`}
            </Text>
          </Text>
          <Text variant="subhead" tone="muted">
            {t.route.arrivalAt(arrival)}
          </Text>
        </View>
        <IconButton
          icon={voice ? Volume2 : VolumeX}
          label={voice ? t.route.voiceOff : t.route.voiceOn}
          selected={voice}
          onPress={onVoice}
        />
      </View>
      <Button testID="route-start" label={t.route.start} icon={Navigation} size="lg" onPress={onStart} />
      <Text variant="caption" tone="muted" className="text-center">
        {t.route.keepAwake}
      </Text>
    </>
  )
}

function NavigationPanel({
  remainingM,
  remainingS,
  voice,
  onVoice,
  onStop,
}: {
  remainingM: number
  remainingS: number
  voice: boolean
  onVoice: () => void
  onStop: () => void
}) {
  const now = useNow(15_000)
  const eta = formatTime(new Date(now + remainingS * 1000))
  return (
    <View className="flex-row items-center gap-2">
      <IconButton testID="route-stop" icon={X} label={t.route.stop} onPress={onStop} className="bg-secondary" />
      <View
        className="flex-1 items-center"
        accessible
        accessibilityLabel={`${t.route.eta} ${eta}, ${formatDuration(remainingS)}, ${formatDistance(remainingM)}`}
      >
        <Text variant="title2" tone="success">
          {eta}
        </Text>
        <Text variant="subhead" tone="muted">
          {`${formatDuration(remainingS)} · ${formatDistance(remainingM)}`}
        </Text>
      </View>
      <IconButton
        icon={voice ? Volume2 : VolumeX}
        label={voice ? t.route.voiceOff : t.route.voiceOn}
        selected={voice}
        onPress={onVoice}
      />
    </View>
  )
}

function ManeuverBanner({
  prepared,
  stepIndex,
  toManeuverM,
  top,
  rerouting,
}: {
  prepared: PreparedRoute
  stepIndex: number
  toManeuverM: number
  top: number
  rerouting: boolean
}) {
  const { colors } = useTheme()
  const steps = prepared.route.steps
  const next = steps[stepIndex + 1] ?? steps[stepIndex]
  const after = steps[stepIndex + 2]
  if (!next) return null
  const Icon = ICONS[maneuverIcon(next)]
  const text = instructionText(next, { departBearing: departBearing(prepared.line) })
  const distance = bannerDistance(toManeuverM)
  return (
    <View className="absolute inset-x-3 gap-2" style={{ top: top + 8 }}>
      <AnimatedView
        key={stepIndex}
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(120)}
        className="flex-row items-center gap-4 rounded-3xl bg-primary px-4 py-3.5"
        style={elevation(3)}
        accessible
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${t.route.in(distance)}, ${text}`}
      >
        <Icon size={40} color={colors['primary-foreground']} strokeWidth={2.4} />
        <View className="flex-1">
          <Text variant="title2" weight="bold" tone="onPrimary">
            {distance}
          </Text>
          <Text variant="callout" weight="medium" tone="onPrimary" numberOfLines={2}>
            {text}
          </Text>
        </View>
      </AnimatedView>
      {after && (
        <View
          className="flex-row items-center gap-2 self-start rounded-full bg-popover px-3 py-1.5"
          style={elevation(2)}
        >
          <Text variant="footnote" weight="semibold" tone="muted">
            {t.route.then}
          </Text>
          {(() => {
            const AfterIcon = ICONS[maneuverIcon(after)]
            return <AfterIcon size={16} color={colors.foreground} />
          })()}
        </View>
      )}
      {rerouting && (
        <View className="flex-row items-center gap-2 self-center rounded-full bg-foreground px-3 py-1.5">
          <Spinner color={colors.background} size={16} />
          <Text variant="footnote" weight="semibold" style={{ color: colors.background }}>
            {t.route.rerouting}
          </Text>
        </View>
      )}
    </View>
  )
}
