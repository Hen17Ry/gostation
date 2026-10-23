/** Outils partagés par les scènes épinglées (storyboard §2). */
import { themeChanged } from '../backdrop'
import { gsap } from '../engine'

/**
 * Timeline d'une scène épinglée, de durée 1 (positions en fraction du passage) : épinglée sur un
 * écran, liée au défilement avec un léger amorti.
 */
export function pinned(section: HTMLElement, screens: number, onUpdate?: (progress: number) => void) {
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: () => `+=${window.innerHeight * screens}`,
      pin: true,
      scrub: 0.9,
      invalidateOnRefresh: true,
      onUpdate: onUpdate && ((self) => onUpdate(self.progress)),
      onRefresh: onUpdate && ((self) => onUpdate(self.progress)),
    },
  })
  return tl
}

/** Termine la timeline exactement à 1 (les positions des étapes sont des fractions). */
export const end = (tl: gsap.core.Timeline) => tl.set({}, {}, 1)

/** Étapes du texte : une à la fois, au même endroit, chacune entre son début et le suivant. */
export function steps(tl: gsap.core.Timeline, items: HTMLElement[], starts: number[], fade = 0.035) {
  items.forEach((el, i) => {
    const at = starts[i]
    if (at === undefined) return
    tl.fromTo(el, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: fade, ease: 'power1.out' }, at)
    const next = starts[i + 1]
    if (next !== undefined) tl.to(el, { autoAlpha: 0, y: -10, duration: fade * 0.8 }, next - fade * 0.8)
  })
}

/** Thème de la section (barre d'en-tête) selon l'avancement. */
export function theme(section: HTMLElement, value: string) {
  if (section.dataset.theme === value) return
  section.dataset.theme = value
  themeChanged()
}

/** Fraction de longueur du chemin la plus proche de chaque point (étapes posées sur un tracé). */
export function fractionsAlong(path: SVGPathElement, points: readonly (readonly number[])[]) {
  const total = path.getTotalLength()
  const samples = 400
  const pts = Array.from({ length: samples + 1 }, (_, i) => path.getPointAtLength((total * i) / samples))
  return points.map(([x, y]) => {
    let best = 0
    let dist = Infinity
    pts.forEach((p, i) => {
      const d = (p.x - x!) ** 2 + (p.y - y!) ** 2
      if (d < dist) {
        dist = d
        best = i
      }
    })
    return best / samples
  })
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** Avancement local d'un intervalle [a, b] de la scène. */
export const local = (p: number, a: number, b: number) => clamp01((p - a) / (b - a))
