import * as Location from 'expo-location'
import * as Speech from 'expo-speech'
import { useEffect, useRef, useState } from 'react'

import { t } from '@/i18n'
import { formatDistance, spokenDistance } from '@/lib/format'
import type { LatLng } from '@/lib/geo'

import { departBearing, instructionText } from './instructions'
import { guidance, type GuidanceState, type PreparedRoute, shouldReroute, voiceCue } from './progress'

/**
 * Guidage pas à pas : suit la position (mémoire seulement, jamais persistée), calcule l'étape en
 * cours et la distance à la prochaine manœuvre, annonce les manœuvres à voix haute si activé,
 * recalcule l'itinéraire au-delà de 50 m d'écart (au plus toutes les 20 s).
 */
export function useGuidance({
  active,
  prepared,
  destination,
  destinationName,
  voice,
  reroute,
  onArrive,
}: {
  active: boolean
  prepared: PreparedRoute | null
  destination: LatLng
  destinationName: string
  voice: boolean
  /** Recalcule depuis une position ; renvoie true si un nouvel itinéraire a été appliqué. */
  reroute: (from: LatLng) => Promise<boolean>
  /** Appelé une fois, à l'arrivée (moins de 30 m de la station). */
  onArrive?: () => void
}) {
  const [state, setState] = useState<GuidanceState | null>(null)
  const [rerouting, setRerouting] = useState(false)
  const route = useRef(prepared)
  const voiceOn = useRef(voice)
  const arriveCb = useRef(onArrive)
  useEffect(() => {
    arriveCb.current = onArrive
  }, [onArrive])
  const memo = useRef({
    hint: 0,
    step: -1,
    cue: null as number | null,
    off: 0,
    lastReroute: 0,
    arrived: false,
    busy: false,
  })

  useEffect(() => {
    route.current = prepared
    memo.current.hint = 0
    memo.current.step = -1
    memo.current.cue = null
  }, [prepared])
  useEffect(() => {
    voiceOn.current = voice
    if (!voice) void Speech.stop()
  }, [voice])

  useEffect(() => {
    if (!active) return
    let sub: Location.LocationSubscription | null = null
    let cancelled = false
    const m = memo.current
    m.arrived = false
    m.lastReroute = Date.now()

    const speak = (text: string) => {
      if (!voiceOn.current) return
      void Speech.stop()
      Speech.speak(text, { language: 'fr-FR', rate: 1 })
    }

    const onFix = (fix: Location.LocationObject) => {
      const p = route.current
      if (!p || cancelled) return
      const position = { lat: fix.coords.latitude, lng: fix.coords.longitude }
      const g = guidance(p, position, destination, m.hint)
      m.hint = g.segment
      setState(g)

      if (g.arrived) {
        if (!m.arrived) {
          m.arrived = true
          speak(t.route.arrivedBody(destinationName))
          arriveCb.current?.()
        }
        return
      }

      const next = p.route.steps[g.stepIndex + 1]
      if (g.stepIndex !== m.step) {
        m.step = g.stepIndex
        m.cue = null
      }
      if (next) {
        const cue = voiceCue(g.toManeuverM, m.cue)
        if (cue !== null) {
          m.cue = cue
          const text = instructionText(next, { departBearing: departBearing(p.line), destination: destinationName })
          speak(cue <= 40 ? text : t.route.spoken(spokenDistance(g.toManeuverM), text))
        }
      }

      const decision = shouldReroute({
        offRouteM: g.offRouteM,
        accuracyM: fix.coords.accuracy ?? null,
        consecutiveOff: m.off,
        lastRerouteAt: m.lastReroute,
        now: Date.now(),
      })
      m.off = decision.consecutiveOff
      if (decision.reroute && !m.busy) {
        m.busy = true
        m.lastReroute = Date.now()
        setRerouting(true)
        void reroute(position).finally(() => {
          m.busy = false
          setRerouting(false)
        })
      }
    }

    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3, timeInterval: 1000 },
      onFix,
    ).then((s) => {
      if (cancelled) s.remove()
      else sub = s
    })

    // Première annonce : le départ.
    const p = route.current
    const first = p?.route.steps[0]
    if (p && first) speak(instructionText(first, { departBearing: departBearing(p.line) }))

    return () => {
      cancelled = true
      sub?.remove()
      void Speech.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la souscription ne dépend que de `active`
  }, [active])

  return { state, rerouting }
}

/** Distance affichée dans le bandeau de manœuvre (arrondie pour rester lisible en roulant). */
export function bannerDistance(m: number): string {
  return m < 1000
    ? formatDistance(m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50)
    : formatDistance(m)
}
