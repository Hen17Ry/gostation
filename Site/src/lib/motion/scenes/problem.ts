/**
 * Scène 2 — Le problème (storyboard §2) : le titre arrive sur l'orange laissé par l'ouverture, la
 * nuit tombe en fondu sur Cotonou, un trajet erre d'une station à l'autre, chacune en rupture,
 * jusqu'à un achat au hasard.
 */
import { backdrop } from '../backdrop'
import type { Rigs } from '../rigs'
import { end, fractionsAlong, pinned, steps, theme } from './common'

export function problem(rigs: Rigs, mm: gsap.MatchMedia) {
  const section = document.querySelector<HTMLElement>('[data-scene="problem"]')
  if (!section) return
  const q = <T extends Element>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!
  const path = q<SVGPathElement>('[data-city] [data-wander-path]')
  const walker = q<SVGGElement>('[data-city] [data-walker]')
  const market = q<SVGGElement>('[data-city] [data-market]')
  const stops = [...document.querySelectorAll<SVGGElement>('[data-city] [data-stop]')]
  const items = [...section.querySelectorAll<HTMLElement>('[data-steps] > li')]
  const duoDark = q<HTMLElement>('[data-duo-dark]', section)
  const kicker = q<HTMLElement>('[data-kicker]', section)
  const scrim = q<HTMLElement>('[data-scrim]', section)
  const city = rigs.city

  // Où chaque station visitée se trouve le long du trajet (fraction de sa longueur).
  const stopPoints = stops.map((g) => {
    const m = g.transform.baseVal.consolidate()?.matrix
    return [m?.e ?? 0, m?.f ?? 0]
  })
  const fractions = fractionsAlong(path, stopPoints)
  const DRAW = { from: 0.15, length: 0.71 }
  const at = (f: number) => DRAW.from + DRAW.length * f

  mm.add({ mobile: '(max-width: 767px)', desktop: '(min-width: 768px)' }, (ctx) => {
    const mobile = !!ctx.conditions?.mobile
    const tl = pinned(section, mobile ? 2 : 2.4, (p) => theme(section, p < 0.07 ? 'brand' : 'night'))

    // L'orange s'efface sur la nuit, la ville apparaît : un fondu, jamais une coupure.
    tl.fromTo(backdrop.w, { orangeOut: 1 }, { orangeOut: 0, duration: 0.15, onUpdate: backdrop.apply }, 0)
      .fromTo(backdrop.w, { nightIn: 0 }, { nightIn: 1, duration: 0.12, onUpdate: backdrop.apply }, 0)
      .fromTo(
        city.poses.in,
        { opacity: 0, scale: 1.08 },
        { opacity: 1, scale: 1, duration: 0.22, ease: 'power1.out', onUpdate: city.apply },
        0.03,
      )
      .fromTo(duoDark, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.1 }, 0.02)
      .fromTo(kicker, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05 }, 0.1)
      .fromTo(scrim, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.08 }, 0.07)
      // Le trajet erre ; le petit repère (la bouteille vide) le suit.
      .fromTo(path, { drawSVG: '0%', autoAlpha: 1 }, { drawSVG: '100%', duration: DRAW.length }, DRAW.from)
      .fromTo(walker, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.02 }, DRAW.from)
      .to(walker, { motionPath: { path, align: path, alignOrigin: [0.5, 0.5] }, duration: DRAW.length }, DRAW.from)

    stops.forEach((stop, i) => {
      const t = at(fractions[i] ?? 0)
      tl.fromTo(
        stop.querySelector('[data-stop-cross]'),
        { drawSVG: '0%', autoAlpha: 1 },
        { drawSVG: '100%', duration: 0.025 },
        t,
      )
      tl.fromTo(
        stop.querySelector('[data-stop-tag]'),
        { autoAlpha: 0, scale: 1.4, transformOrigin: '50% 100%' },
        { autoAlpha: 1, scale: 1, duration: 0.03, ease: 'back.out(2)' },
        t,
      )
    })
    tl.fromTo(
      market,
      { autoAlpha: 0, scale: 0.5, transformOrigin: '50% 50%' },
      { autoAlpha: 1, scale: 1, duration: 0.04 },
      0.86,
    )

    steps(tl, items, [...fractions.map(at), 0.86])
    end(tl)
  })
}
