/**
 * Scène 4 — L'itinéraire (storyboard §2) : la carte se rapproche du trajet, le tracé (vraies
 * routes, OSRM) se dessine et un zémidjan le suit au rythme du défilement ; le téléphone guide
 * étape par étape ; à l'arrivée, l'épingle pulse et le badge « mis à jour il y a 12 min » se pose.
 */
import { city as data, fractionsOnPolyline, pathCenter } from '../../city'
import { NAV_STEPS, type Screen } from '../../phone/painter'
import type { Rigs } from '../rigs'
import { end, local, pinned, steps } from './common'

const DRAW = { from: 0.14, length: 0.7 }

export function route(rigs: Rigs, mm: gsap.MatchMedia) {
  const section = document.querySelector<HTMLElement>('[data-scene="route"]')
  if (!section) return
  const items = [...section.querySelectorAll<HTMLElement>('[data-steps] > li')]
  const q = <T extends Element>(sel: string) => document.querySelector<T>(`[data-city] ${sel}`)!
  const line = q<SVGPathElement>('[data-route-path]')
  const casing = q<SVGPathElement>('.route-casing')
  const moto = q<SVGGElement>('[data-moto]')
  const arrival = q<SVGGElement>('[data-arrival]')
  const ring = q<SVGCircleElement>('[data-arrival-ring]')
  const badge = q<SVGGElement>('[data-badge]')
  // Le groupe de la recherche (anneaux, stations) appartient à cette scène ; ses éléments, à la
  // scène 3. Chaque élément n'est animé que par une scène : l'état reste juste dans les deux sens.
  const search = q<SVGGElement>('[data-search]')
  const { phone, city } = rigs

  // Manœuvres le long du tracé : l'écran du téléphone passe à la suivante quand le zémidjan y arrive.
  const marks = fractionsOnPolyline(
    data.route.d,
    NAV_STEPS.map((s) => s.at),
  )
  const screenAt = (p: number): Screen => {
    if (p < 0.1) return { kind: 'results' }
    if (p > DRAW.from + DRAW.length + 0.01) return { kind: 'arrived' }
    const f = local(p, DRAW.from, DRAW.from + DRAW.length)
    let step = marks.findIndex((m) => f < m)
    if (step < 0) step = marks.length - 1
    const start = step === 0 ? 0 : marks[step - 1]!
    return { kind: 'navigation', step, progress: Math.round(local(f, start, marks[step]!) * 10) / 10 }
  }

  // Cadrage : le centre du trajet vient en `focus` (fraction de l'écran), agrandi `zoom` fois.
  const center = pathCenter(data.route.d)
  const camera = (focus: readonly [number, number], zoom: number) => {
    const [px, py] = city.toScreen(center, { width: data.width, height: data.height })
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    return {
      x: focus[0] * window.innerWidth - cx - zoom * (px - cx),
      y: focus[1] * window.innerHeight - cy - zoom * (py - cy),
      scale: zoom,
    }
  }

  mm.add({ mobile: '(max-width: 767px)', desktop: '(min-width: 768px)' }, (ctx) => {
    const mobile = !!ctx.conditions?.mobile
    const focus: [number, number] = mobile ? [0.5, 0.42] : [0.47, 0.56]
    const zoom = mobile ? 1.3 : 1.6
    const tl = pinned(section, (p) => phone.setScreen(screenAt(p), 2, p))

    tl.fromTo(
      city.poses.cam,
      { x: 0, y: 0, scale: 1 },
      {
        x: () => camera(focus, zoom).x,
        y: () => camera(focus, zoom).y,
        scale: zoom,
        duration: DRAW.from,
        ease: 'power2.inOut',
        onUpdate: city.apply,
      },
      0,
    )
      .fromTo(search, { opacity: 1 }, { opacity: 0.16, duration: 0.08 }, 0)
      .fromTo(
        phone.poses.move,
        { x: 0, y: 0, scale: 1, rotY: 0 },
        mobile
          ? { y: () => window.innerHeight * 0.14, scale: 0.78, duration: DRAW.from, onUpdate: phone.apply }
          : { x: () => window.innerWidth * 0.03, scale: 0.9, rotY: 10, duration: DRAW.from, onUpdate: phone.apply },
        0,
      )
      .fromTo([casing, line], { drawSVG: '0%', autoAlpha: 1 }, { drawSVG: '100%', duration: DRAW.length }, DRAW.from)
      .fromTo(moto, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.02 }, DRAW.from)
      .to(
        moto,
        { motionPath: { path: line, align: line, alignOrigin: [0.5, 0.5], autoRotate: 90 }, duration: DRAW.length },
        DRAW.from,
      )
      .fromTo(
        arrival,
        { autoAlpha: 0, scale: 0.4, transformOrigin: '50% 50%' },
        { autoAlpha: 1, scale: 1, duration: 0.04 },
        0.82,
      )
      .fromTo(
        ring,
        { scale: 1, autoAlpha: 1, transformOrigin: '50% 50%' },
        { scale: 2.6, autoAlpha: 0, duration: 0.08 },
        0.86,
      )
      .fromTo(badge, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.05, ease: 'power2.out' }, 0.87)

    const second = DRAW.from + DRAW.length * (marks[0] ?? 0.3)
    steps(tl, items, [0.04, second, 0.86])
    end(tl)
  })
}
