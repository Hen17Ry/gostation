import type { Route } from '@/api/schemas'
import { cumulativeLengths, decodePolyline, distanceM, type LatLng, routeProgress } from '@/lib/geo'

/** Écart au tracé au-delà duquel on recalcule l'itinéraire (m). */
export const OFF_ROUTE_M = 50
/** Intervalle minimal entre deux recalculs (ms) : limite la data et la charge OSRM. */
export const REROUTE_MIN_INTERVAL_MS = 20_000
/** Mesures hors du tracé d'affilée avant de recalculer (filtre le bruit du GPS). */
export const OFF_ROUTE_FIXES = 2
/** Distance à la station sous laquelle on considère l'utilisateur arrivé (m). */
export const ARRIVAL_M = 30

/** Itinéraire préparé pour le guidage : tracé décodé, longueurs cumulées, début de chaque étape. */
export interface PreparedRoute {
  route: Route
  line: LatLng[]
  cumulative: number[]
  stepStarts: number[]
  totalM: number
}

export function prepareRoute(route: Route): PreparedRoute {
  const line = decodePolyline(route.geometry, 6)
  const cumulative = cumulativeLengths(line)
  const totalM = cumulative[cumulative.length - 1] ?? 0
  // Les distances d'étapes OSRM s'additionnent ; on les recale sur la longueur réelle du tracé.
  const stepsTotal = route.steps.reduce((s, st) => s + st.distanceM, 0) || 1
  const scale = totalM / stepsTotal
  const stepStarts: number[] = []
  let acc = 0
  for (const st of route.steps) {
    stepStarts.push(acc)
    acc += st.distanceM * scale
  }
  return { route, line, cumulative, stepStarts, totalM }
}

export interface GuidanceState {
  /** Indice de l'étape en cours (la prochaine manœuvre est l'étape suivante). */
  stepIndex: number
  /** Distance jusqu'à la prochaine manœuvre (m). */
  toManeuverM: number
  remainingM: number
  /** Durée restante estimée (s), au prorata de la durée OSRM. */
  remainingS: number
  offRouteM: number
  snapped: LatLng
  segment: number
  arrived: boolean
}

/** État du guidage pour une position (pur : testé sans appareil). */
export function guidance(p: PreparedRoute, position: LatLng, destination: LatLng, hint = 0): GuidanceState {
  const prog = routeProgress(position, p.line, p.cumulative, hint)
  let stepIndex = 0
  for (let i = 0; i < p.stepStarts.length; i++) if (p.stepStarts[i]! <= prog.traveledM + 1) stepIndex = i
  const nextStart = p.stepStarts[stepIndex + 1] ?? p.totalM
  const ratio = p.totalM > 0 ? prog.remainingM / p.totalM : 0
  return {
    stepIndex,
    toManeuverM: Math.max(0, nextStart - prog.traveledM),
    remainingM: prog.remainingM,
    remainingS: Math.round(p.route.durationS * ratio),
    offRouteM: prog.offRouteM,
    snapped: prog.snapped,
    segment: prog.segment,
    arrived: distanceM(position, destination) <= ARRIVAL_M || prog.remainingM <= ARRIVAL_M,
  }
}

/**
 * Décide d'un recalcul : hors du tracé de plus de 50 m sur plusieurs mesures assez précises, et
 * pas plus d'un recalcul toutes les 20 s.
 */
export function shouldReroute(input: {
  offRouteM: number
  accuracyM: number | null
  consecutiveOff: number
  lastRerouteAt: number
  now: number
}): { reroute: boolean; consecutiveOff: number } {
  const precise = input.accuracyM === null || input.accuracyM <= 40
  const off = precise && input.offRouteM > OFF_ROUTE_M
  const consecutiveOff = off ? input.consecutiveOff + 1 : 0
  const reroute = consecutiveOff >= OFF_ROUTE_FIXES && input.now - input.lastRerouteAt >= REROUTE_MIN_INTERVAL_MS
  return { reroute, consecutiveOff: reroute ? 0 : consecutiveOff }
}

/** Seuils d'annonce vocale avant une manœuvre (m) : loin, proche, immédiat. */
export const VOICE_THRESHOLDS = [800, 200, 40] as const

/** Prochain seuil franchi (annonce à faire) depuis la dernière annonce, ou null. */
export function voiceCue(toManeuverM: number, lastCue: number | null): number | null {
  for (const t of VOICE_THRESHOLDS) {
    if (toManeuverM <= t && (lastCue === null || t < lastCue)) {
      // Seuil franchi : on n'annonce que le plus proche (pas d'annonces en rafale).
      const nearest = VOICE_THRESHOLDS.filter((x) => toManeuverM <= x).at(-1)!
      return nearest
    }
  }
  return null
}
