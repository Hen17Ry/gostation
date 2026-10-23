/**
 * Scène 3 — La solution (storyboard §2) : le téléphone entre, on choisit Gaz puis 10 kg, l'onde de
 * recherche s'élargit par paliers comme le vrai algorithme (500 m, 1 km, 2 km) et seules les
 * stations ouvertes avec du stock s'allument ; le téléphone affiche les résultats.
 */
import { city as data } from '../../city'
import type { Screen } from '../../phone/painter'
import type { Rigs } from '../rigs'
import { end, local, pinned, steps } from './common'

/** Écran du téléphone selon l'avancement de la scène (taps, paliers, résultats). */
function screenAt(p: number): Screen {
  const tap = (x: number, y: number, a: number, b: number) => ({ x, y, t: local(p, a, b) })
  if (p < 0.16) return { kind: 'search', product: null, size: null }
  if (p < 0.2) return { kind: 'search', product: null, size: null, tap: tap(66, 461, 0.16, 0.2) }
  if (p < 0.24) return { kind: 'search', product: 'gaz', size: null }
  if (p < 0.27) return { kind: 'search', product: 'gaz', size: null, tap: tap(117, 555, 0.24, 0.27) }
  if (p < 0.3) return { kind: 'search', product: 'gaz', size: 10, pressed: true, tap: tap(180, 619, 0.27, 0.3) }
  if (p < 0.46) return { kind: 'searching', radius: '500 m' }
  if (p < 0.6) return { kind: 'searching', radius: '1 km' }
  if (p < 0.8) return { kind: 'searching', radius: '2 km' }
  return { kind: 'results' }
}

export function solution(rigs: Rigs, mm: gsap.MatchMedia) {
  const section = document.querySelector<HTMLElement>('[data-scene="solution"]')
  if (!section) return
  const items = [...section.querySelectorAll<HTMLElement>('[data-steps] > li')]
  const wander = document.querySelector<SVGGElement>('[data-city] [data-wander]')
  const rings = [...document.querySelectorAll<SVGGElement>('[data-city] [data-ring]')]
  const stations = [...document.querySelectorAll<SVGGElement>('[data-city] [data-station]')]
  const ranks = [...document.querySelectorAll<SVGGElement>('[data-city] [data-station] .station-rank')]
  const [ux, uy] = data.user.at
  const phone = rigs.phone

  mm.add({ mobile: '(max-width: 767px)', desktop: '(min-width: 768px)' }, (ctx) => {
    const mobile = !!ctx.conditions?.mobile
    const tl = pinned(section, (p) => phone.setScreen(screenAt(p), 1, p))

    // Le téléphone entre en pivotant (par la droite sur ordinateur, par le bas sur mobile).
    tl.fromTo(
      phone.poses.enter,
      mobile
        ? { x: 0, y: () => window.innerHeight * 0.6, rotY: -24, opacity: 0 }
        : { x: () => window.innerWidth * 0.42, y: 0, rotY: -42, opacity: 0 },
      { x: 0, y: 0, rotY: mobile ? -6 : -14, opacity: 1, duration: 0.16, ease: 'power2.out', onUpdate: phone.apply },
      0,
    )
    if (wander) tl.fromTo(wander, { autoAlpha: 1 }, { autoAlpha: 0.14, duration: 0.1 }, 0)

    // Paliers de l'onde ; à chacun, les stations du nouvel anneau se révèlent.
    const limits = [0, 500, 1000, 2000]
    rings.forEach((ring, i) => {
      const t = [0.32, 0.46, 0.6][i] ?? 0.6
      tl.fromTo(
        ring,
        { autoAlpha: 0, scale: 0.15, svgOrigin: `${ux} ${uy}` },
        { autoAlpha: 1, scale: 1, duration: 0.08, ease: 'power2.out' },
        t,
      )
      const inside = stations.filter((s) => {
        const d = Number(s.dataset.distance)
        return d > limits[i]! && d <= limits[i + 1]!
      })
      if (inside.length) {
        tl.fromTo(
          inside,
          { autoAlpha: 0, scale: 0.3, transformOrigin: '50% 50%' },
          { autoAlpha: 1, scale: 1, duration: 0.04, stagger: 0.012, ease: 'back.out(2)' },
          t + 0.07,
        )
      }
      // Les anneaux précédents s'estompent : l'œil suit le palier en cours.
      if (i > 0)
        tl.fromTo(rings[i - 1]!, { autoAlpha: 1 }, { autoAlpha: 0.35, duration: 0.05, immediateRender: false }, t)
    })
    tl.fromTo(
      ranks,
      { autoAlpha: 0, scale: 0.4, transformOrigin: '50% 50%' },
      { autoAlpha: 1, scale: 1, duration: 0.04, stagger: 0.02 },
      0.8,
    )

    steps(tl, items, [0.04, 0.32, 0.62, 0.8])
    end(tl)
  })
}
