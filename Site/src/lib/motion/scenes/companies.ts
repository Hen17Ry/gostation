/**
 * Scène 6 — Pour les compagnies (storyboard §2), sans épinglage : à son arrivée, la nuit et la
 * braise s'effacent en fondu vers le fond de page, le téléphone s'en va ; le texte, la carte du
 * réseau et l'aperçu du panneau entrent.
 */
import { backdrop } from '../backdrop'
import { gsap, invalidateOnResize } from '../engine'
import type { Rigs } from '../rigs'

export function companies(rigs: Rigs) {
  const section = document.querySelector<HTMLElement>('[data-scene="companies"]')
  if (!section) return
  const { phone } = rigs

  invalidateOnResize(
    gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { trigger: section, start: 'top bottom', end: 'top 30%', scrub: 0.6 },
    }),
  )
    .fromTo(backdrop.w, { darkOut: 1 }, { darkOut: 0, duration: 1, onUpdate: backdrop.apply }, 0)
    .fromTo(
      phone.poses.out,
      { y: 0, opacity: 1, scale: 1 },
      { y: () => -window.innerHeight * 0.5, opacity: 0, scale: 0.85, duration: 0.8, onUpdate: phone.apply },
      0,
    )

  // Déclencheurs portés par des timelines, pas par des tweens : ScrollTrigger reporte alors leur
  // mesure au rafraîchissement unique qui suit la création des scènes (main.ts), au lieu d'une
  // mise en page forcée par déclencheur.
  const entering = (trigger: Element, start: string) =>
    gsap.timeline({ scrollTrigger: { trigger, start, toggleActions: 'play none none reverse' } })
  const reveal = (targets: gsap.TweenTarget, vars: gsap.TweenVars, trigger: Element) =>
    entering(trigger, 'top 78%').from(targets, {
      autoAlpha: 0,
      y: 28,
      duration: 0.7,
      ease: 'expo.out',
      stagger: 0.08,
      ...vars,
    })

  const copy = section.querySelector('[data-companies-copy]')
  if (copy) reveal(copy.children, {}, copy)
  const network = section.querySelector('[data-network]')
  if (network) {
    reveal(network, {}, network)
    entering(network, 'top 70%').from(network.querySelectorAll('[data-net-station]'), {
      autoAlpha: 0,
      scale: 0.3,
      transformOrigin: '50% 50%',
      duration: 0.5,
      ease: 'back.out(2)',
      stagger: 0.07,
    })
  }
  const dashboard = section.querySelector('[data-dashboard]')
  if (dashboard) {
    reveal(dashboard, { delay: 0.1 }, dashboard)
    entering(dashboard, 'top 75%').from(dashboard.querySelectorAll('[data-bar]'), {
      scaleX: 0,
      duration: 0.9,
      ease: 'expo.out',
      stagger: 0.08,
    })
  }

  // En remontant, chaque bloc s'efface juste avant de passer sous l'en-tête. Par filter: opacity(),
  // que GSAP n'anime pas : les apparitions ci-dessus gardent seules l'opacité, les deux se
  // multiplient. Remis à zéro à chaque création de la scène (elle peut être recréée, lazy-scenes.ts).
  const header = document.querySelector<HTMLElement>('[data-site-header] .header-bar')
  const blocks = [...(copy?.children ?? []), network, dashboard].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  )
  for (const el of blocks) el.style.filter = ''
  const written = new Map<HTMLElement, number>()
  // Porté par une timeline (vide) : ScrollTrigger reporte sa mesure au rafraîchissement commun. Un
  // déclencheur autonome se mesurerait tout de suite, en rendant au passage les scènes d'avant dans
  // le contexte de celle-ci (leurs tweens internes y seraient rangées, lazy-scenes.ts).
  gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: 'top 40%',
      end: 'bottom top',
      onUpdate: () => {
        const line = (header?.getBoundingClientRect().bottom ?? 64) + 8
        const tops = blocks.map((el) => el.getBoundingClientRect().top)
        blocks.forEach((el, i) => {
          const alpha = Math.round(Math.min(1, Math.max(0, (tops[i]! - line) / 56)) * 100) / 100
          if (alpha === (written.get(el) ?? 1)) return
          written.set(el, alpha)
          el.style.filter = alpha === 1 ? '' : `opacity(${alpha})`
        })
      },
    },
  })
}
