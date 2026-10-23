/**
 * Scène 7 — Final (storyboard §2) : un volet orange couvre l'écran, se resserre en barre qui
 * devient la hampe du T, GOSTATION se révèle lettre par lettre ; puis zoom arrière : le sud du
 * Bénin, la Terre de nuit avec le Bénin en orange (globe 3D en mode complet), et les actions.
 * Scène 8 — Questions : l'espace s'efface en fondu vers le fond de page.
 */
import { backdrop } from '../backdrop'
import { gsap, invalidateOnResize } from '../engine'
import type { Rigs } from '../rigs'
import { end, pinned, theme } from './common'

/** Ordre de révélation : du T vers l'extérieur, en alternance. */
const ORDER = [3, 2, 4, 1, 5, 0, 6, 7, 8]

export function final(rigs: Rigs, mm: gsap.MatchMedia) {
  const section = document.querySelector<HTMLElement>('[data-scene="final"]')
  if (!section) return
  const wipe = section.querySelector<HTMLElement>('[data-wipe]')!
  const stage = section.querySelector<HTMLElement>('[data-final-stage]')!
  const letters = [...section.querySelectorAll<HTMLElement>('[data-letter]')]
  const tagline = section.querySelector<HTMLElement>('[data-final-tagline]')!
  const cta = section.querySelector<HTMLElement>('[data-final-cta]')!
  const region = document.querySelector<HTMLElement>('[data-space-region]')!
  const { earth } = rigs
  const t = letters[3]!

  /**
   * Rectangle de la hampe du T (repère de la section) : la barre y atterrit. Mesuré en positions de
   * mise en page (offset*), que les transformations en cours (zoom arrière, lettres) ne faussent pas.
   */
  const stem = () => {
    const size = parseFloat(getComputedStyle(t).fontSize)
    const width = size * 0.19
    return {
      x: stage.offsetLeft + t.offsetLeft + t.offsetWidth / 2 - width / 2,
      y: stage.offsetTop + t.offsetTop + size * 0.07,
      width,
      height: size * 0.72,
    }
  }

  mm.add({ mobile: '(max-width: 767px)', desktop: '(min-width: 768px)' }, (ctx) => {
    const mobile = !!ctx.conditions?.mobile
    const tl = pinned(section, mobile ? 2.4 : 2.8, (p) => theme(section, p < 0.62 ? 'page' : 'night'))
    const W = () => section.clientWidth
    const H = () => section.clientHeight

    tl.set(letters, { yPercent: 110 }, 0)
      .set(t, { yPercent: 0, autoAlpha: 0 }, 0)
      .set([tagline, cta], { autoAlpha: 0 }, 0)
      // Le volet orange couvre l'écran depuis la droite…
      .fromTo(wipe, { scaleX: 0, autoAlpha: 1 }, { scaleX: 1, duration: 0.12, ease: 'power2.inOut' }, 0)
      // … puis se resserre en barre, exactement sur la hampe du T.
      .to(
        wipe,
        {
          scaleX: () => stem().width / W(),
          scaleY: () => stem().height / H(),
          x: () => stem().x + stem().width - W(),
          y: () => stem().y + stem().height / 2 - H() / 2,
          duration: 0.14,
          ease: 'power3.inOut',
        },
        0.13,
      )
      .to(t, { autoAlpha: 1, duration: 0.03 }, 0.27)
      .to(wipe, { autoAlpha: 0, duration: 0.03 }, 0.28)
    ORDER.slice(1).forEach((i, k) => {
      tl.to(letters[i]!, { yPercent: 0, duration: 0.05, ease: 'power3.out' }, 0.3 + k * 0.022)
    })
    tl.fromTo(tagline, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.05 }, 0.5)

    // Zoom arrière : l'espace en fondu, le mot monte, le sud du Bénin puis la Terre.
    tl.fromTo(backdrop.w, { spaceIn: 0 }, { spaceIn: 1, duration: 0.1, onUpdate: backdrop.apply }, 0.56)
      .fromTo(
        stage,
        { y: 0, scale: 1 },
        { y: () => -H() * (mobile ? 0.31 : 0.33), scale: mobile ? 0.78 : 0.5, duration: 0.16, ease: 'power2.inOut' },
        0.6,
      )
      .fromTo(region, { autoAlpha: 0, scale: 1.6 }, { autoAlpha: 0.9, scale: 1, duration: 0.1 }, 0.6)
      .to(region, { scale: 0.45, duration: 0.14, ease: 'power1.in' }, 0.7)
      .to(region, { autoAlpha: 0, duration: 0.06 }, 0.78)
      .fromTo(
        earth.poses.zoom,
        { opacity: 0, scale: 3.2, y: 0 },
        {
          opacity: 1,
          scale: mobile ? 0.82 : 0.7,
          y: () => H() * (mobile ? 0 : 0.045),
          duration: 0.2,
          ease: 'power2.out',
          onUpdate: earth.apply,
        },
        0.74,
      )
      .fromTo(cta, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.06, ease: 'power2.out' }, 0.9)
    end(tl)
  })

  // Scène 8 : l'espace et la Terre s'effacent vers le fond de page.
  const questions = document.querySelector('[data-scene="questions"]')
  if (questions) {
    invalidateOnResize(
      gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: questions, start: 'top bottom', end: 'top 35%', scrub: 0.6 },
      }),
    )
      .fromTo(backdrop.w, { spaceOut: 1 }, { spaceOut: 0, duration: 1, onUpdate: backdrop.apply }, 0)
      .fromTo(
        earth.poses.out,
        { opacity: 1, y: 0 },
        { opacity: 0, y: () => -window.innerHeight * 0.3, duration: 0.8, onUpdate: earth.apply },
        0,
      )
  }
}
