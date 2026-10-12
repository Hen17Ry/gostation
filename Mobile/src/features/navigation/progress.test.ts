import type { Route } from '@/api/schemas'
import { cumulativeLengths } from '@/lib/geo'

import { guidance, OFF_ROUTE_M, prepareRoute, REROUTE_MIN_INTERVAL_MS, shouldReroute, voiceCue } from './progress'

// Tracé polyline6 encodé de trois points vers l'est puis le nord (Cotonou).
const points = [
  { lat: 6.37, lng: 2.4 },
  { lat: 6.37, lng: 2.41 },
  { lat: 6.38, lng: 2.41 },
]
function encode(pts: { lat: number; lng: number }[]) {
  let out = ''
  let pl = 0
  let pg = 0
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1
    let s = ''
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63)
      n >>= 5
    }
    return s + String.fromCharCode(n + 63)
  }
  for (const p of pts) {
    const la = Math.round(p.lat * 1e6)
    const lo = Math.round(p.lng * 1e6)
    out += enc(la - pl) + enc(lo - pg)
    pl = la
    pg = lo
  }
  return out
}

const leg1 = cumulativeLengths(points.slice(0, 2))[1]!
const leg2 = cumulativeLengths(points.slice(1))[1]!

const route: Route = {
  stationId: 's',
  distanceM: Math.round(leg1 + leg2),
  durationS: 300,
  geometry: encode(points),
  geometryEncoding: 'polyline6',
  steps: [
    { maneuver: { type: 'depart', location: points[0]! }, name: 'Rue A', distanceM: leg1, durationS: 150 },
    {
      maneuver: { type: 'turn', modifier: 'left', location: points[1]! },
      name: 'Rue B',
      distanceM: leg2,
      durationS: 150,
    },
    { maneuver: { type: 'arrive', location: points[2]! }, name: '', distanceM: 0, durationS: 0 },
  ],
}

describe('guidance', () => {
  const p = prepareRoute(route)

  it('donne la distance jusqu’au virage pendant la première étape', () => {
    const g = guidance(p, { lat: 6.37, lng: 2.405 }, points[2]!)
    expect(g.stepIndex).toBe(0)
    expect(g.toManeuverM).toBeGreaterThan(leg1 / 2 - 10)
    expect(g.toManeuverM).toBeLessThan(leg1 / 2 + 10)
    expect(g.remainingS).toBeGreaterThan(200)
    expect(g.arrived).toBe(false)
  })

  it('passe à l’étape suivante après le virage', () => {
    const g = guidance(p, { lat: 6.375, lng: 2.41 }, points[2]!)
    expect(g.stepIndex).toBe(1)
    expect(g.remainingM).toBeGreaterThan(leg2 / 2 - 10)
  })

  it('signale l’arrivée à moins de 30 m de la station', () => {
    expect(guidance(p, { lat: 6.37985, lng: 2.41 }, points[2]!).arrived).toBe(true)
  })
})

describe('shouldReroute', () => {
  const base = { accuracyM: 10, consecutiveOff: 0, lastRerouteAt: 0, now: 100_000 }

  it('attend deux mesures hors du tracé avant de recalculer', () => {
    const first = shouldReroute({ ...base, offRouteM: OFF_ROUTE_M + 5 })
    expect(first).toEqual({ reroute: false, consecutiveOff: 1 })
    const second = shouldReroute({ ...base, offRouteM: OFF_ROUTE_M + 5, consecutiveOff: first.consecutiveOff })
    expect(second.reroute).toBe(true)
  })

  it('ne recalcule pas sous 50 m ni avec une mesure imprécise', () => {
    expect(shouldReroute({ ...base, offRouteM: 40, consecutiveOff: 5 }).reroute).toBe(false)
    expect(shouldReroute({ ...base, offRouteM: 120, accuracyM: 80, consecutiveOff: 5 }).reroute).toBe(false)
  })

  it('limite la fréquence des recalculs', () => {
    const now = 100_000
    const tooSoon = shouldReroute({
      ...base,
      now,
      offRouteM: 200,
      consecutiveOff: 3,
      lastRerouteAt: now - REROUTE_MIN_INTERVAL_MS + 1,
    })
    expect(tooSoon.reroute).toBe(false)
    const later = shouldReroute({
      ...base,
      now,
      offRouteM: 200,
      consecutiveOff: 3,
      lastRerouteAt: now - REROUTE_MIN_INTERVAL_MS,
    })
    expect(later.reroute).toBe(true)
  })
})

describe('voiceCue', () => {
  it('annonce chaque seuil une seule fois, le plus proche franchi', () => {
    expect(voiceCue(1200, null)).toBeNull()
    expect(voiceCue(750, null)).toBe(800)
    expect(voiceCue(700, 800)).toBeNull()
    expect(voiceCue(150, 800)).toBe(200)
    expect(voiceCue(30, 200)).toBe(40)
    expect(voiceCue(10, 40)).toBeNull()
    // Arrivée directe près du virage : pas d'annonce « dans 800 m ».
    expect(voiceCue(30, null)).toBe(40)
  })
})
