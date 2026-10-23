/**
 * Scène 6 — Pour les compagnies (storyboard §2), sans épinglage : à son arrivée, la nuit et la
 * braise s'effacent en fondu vers le fond de page, le téléphone s'en va ; le texte, la carte du
 * réseau et l'aperçu du panneau entrent.
 */
import { backdrop } from '../backdrop'
import { gsap } from '../engine'
import type { Rigs } from '../rigs'

export function companies(rigs: Rigs) {
  const section = document.querySelector<HTMLElement>('[data-scene="companies"]')
  if (!section) return
  const { phone } = rigs

  gsap
    .timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { trigger: section, start: 'top bottom', end: 'top 30%', scrub: 0.6 },
    })
    .fromTo(backdrop.w, { darkOut: 1 }, { darkOut: 0, duration: 1, onUpdate: backdrop.apply }, 0)
    .fromTo(
      phone.poses.out,
      { y: 0, opacity: 1, scale: 1 },
      { y: () => -window.innerHeight * 0.5, opacity: 0, scale: 0.85, duration: 0.8, onUpdate: phone.apply },
      0,
    )

  const reveal = (targets: gsap.TweenTarget, vars: gsap.TweenVars, trigger: Element) =>
    gsap.from(targets, {
      autoAlpha: 0,
      y: 28,
      duration: 0.7,
      ease: 'expo.out',
      stagger: 0.08,
      ...vars,
      scrollTrigger: { trigger, start: 'top 78%', toggleActions: 'play none none reverse' },
    })

  const copy = section.querySelector('[data-companies-copy]')
  if (copy) reveal(copy.children, {}, copy)
  const network = section.querySelector('[data-network]')
  if (network) {
    reveal(network, {}, network)
    gsap.from(network.querySelectorAll('[data-net-station]'), {
      autoAlpha: 0,
      scale: 0.3,
      transformOrigin: '50% 50%',
      duration: 0.5,
      ease: 'back.out(2)',
      stagger: 0.07,
      scrollTrigger: { trigger: network, start: 'top 70%', toggleActions: 'play none none reverse' },
    })
  }
  const dashboard = section.querySelector('[data-dashboard]')
  if (dashboard) {
    reveal(dashboard, { delay: 0.1 }, dashboard)
    gsap.from(dashboard.querySelectorAll('[data-bar]'), {
      scaleX: 0,
      duration: 0.9,
      ease: 'expo.out',
      stagger: 0.08,
      scrollTrigger: { trigger: dashboard, start: 'top 75%', toggleActions: 'play none none reverse' },
    })
  }
}
