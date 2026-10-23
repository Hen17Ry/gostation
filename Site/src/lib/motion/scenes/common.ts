/** Outils partagés par les scènes épinglées (storyboard §2). */
import { themeChanged } from '../backdrop'
import { gsap, invalidateOnResize } from '../engine'

/** Enveloppe de la scène dans la page (pages/index.astro), employée comme pin-spacer. */
export const spacerOf = (section: HTMLElement) => section.closest<HTMLElement>('[data-pin]') ?? undefined

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
      pinSpacer: spacerOf(section),
      scrub: 0.9,
      onUpdate: onUpdate && ((self) => onUpdate(self.progress)),
      onRefresh: onUpdate && ((self) => onUpdate(self.progress)),
    },
  })
  return invalidateOnResize(tl)
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

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** Avancement local d'un intervalle [a, b] de la scène. */
export const local = (p: number, a: number, b: number) => clamp01((p - a) / (b - a))
