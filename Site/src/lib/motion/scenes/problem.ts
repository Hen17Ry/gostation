/**
 * Scène 2 — Le problème (storyboard §2) : le titre arrive sur l'orange laissé par l'ouverture, la
 * nuit tombe en fondu sur Cotonou, un trajet erre d'une station à l'autre, chacune en rupture,
 * jusqu'à un achat au hasard.
 */
import { city as data, fractionsOnPolyline } from '../../city'
import { backdrop } from '../backdrop'
import { gsap } from '../engine'
import type { Rigs } from '../rigs'
import { end, leave, pinned, steps, theme } from './common'

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
  const copy = q<HTMLElement>('.scene-copy', section)
  const city = rigs.city

  // Avant l'épinglage : la scène remonte sur la fin de l'ouverture (global.css) et son titre
  // apparaît pendant que l'orange envahit l'écran ; il est en place quand l'orange le couvre.
  gsap
    .timeline({ scrollTrigger: { trigger: section, start: 'top 38%', end: 'top 6%', scrub: 0.6 } })
    .fromTo(copy, { autoAlpha: 0 }, { autoAlpha: 1, ease: 'power1.out' })

  // Où chaque station visitée se trouve le long du trajet (fraction de sa longueur).
  const fractions = fractionsOnPolyline(data.wander.d, data.wander.stops)
  const DRAW = { from: 0.2, length: 0.66 }
  const at = (f: number) => DRAW.from + DRAW.length * f

  // Points de rupture : la durée d'épinglage change (global.css), la scène est recréée.
  mm.add({ mobile: '(max-width: 767px)', desktop: '(min-width: 768px)' }, () => {
    const tl = pinned(section, (p) => theme(section, p < 0.12 ? 'brand' : 'night'))

    // Le titre reste un temps sur l'orange, puis la nuit tombe comme un coucher de soleil : l'orange
    // s'attarde et s'assombrit de plus en plus vite (fondu, jamais une coupure). La nuit est posée
    // dessous d'emblée, invisible sous l'orange.
    tl.fromTo(backdrop.w, { nightIn: 0 }, { nightIn: 1, duration: 0.02, onUpdate: backdrop.apply }, 0)
      .fromTo(
        backdrop.w,
        { orangeOut: 1 },
        { orangeOut: 0, duration: 0.14, ease: 'power2.in', onUpdate: backdrop.apply },
        0.06,
      )
      .fromTo(
        city.poses.in,
        { opacity: 0, scale: 1.08 },
        { opacity: 1, scale: 1, duration: 0.2, ease: 'power1.out', onUpdate: city.apply },
        0.1,
      )
      .fromTo(duoDark, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.07, ease: 'power1.in' }, 0.09)
      .fromTo(kicker, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05 }, 0.15)
      .fromTo(scrim, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.08 }, 0.12)
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
    leave(tl, section)
    end(tl)
  })
}
