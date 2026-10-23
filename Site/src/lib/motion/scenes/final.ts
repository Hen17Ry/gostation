/**
 * Scène 7 — Final (storyboard §2), sur la nuit : la nuit monte avec la scène et recouvre la page,
 * un trait orange traverse l'écran à hauteur de la hampe du T et s'y resserre, GOSTATION se révèle
 * lettre par lettre ; puis zoom arrière, sans changer de fond : le sud du Bénin, la Terre de nuit
 * avec le Bénin en orange (globe 3D en mode complet), et les actions, chacun à sa place.
 * Scène 8 — Questions : le final remonte et la Terre s'efface ; la FAQ suit, sur le même ciel.
 */
import { backdrop } from '../backdrop'
import { gsap, invalidateOnResize } from '../engine'
import type { Rigs } from '../rigs'
import { end, pinned, theme } from './common'

/** Ordre de révélation : du T vers l'extérieur, en alternance. */
const ORDER = [3, 2, 4, 1, 5, 0, 6, 7, 8]

/** Le mot, au bout du zoom arrière : remonté (fraction de l'écran) et réduit. */
const STAGE = { desktop: { lift: 0.33, scale: 0.5 }, mobile: { lift: 0.31, scale: 0.78 } }

export function final(rigs: Rigs, mm: gsap.MatchMedia) {
  const section = document.querySelector<HTMLElement>('[data-scene="final"]')
  if (!section) return
  const night = section.querySelector<HTMLElement>('[data-final-night]')!
  const wipe = section.querySelector<HTMLElement>('[data-wipe]')!
  const stage = section.querySelector<HTMLElement>('[data-final-stage]')!
  const letters = [...section.querySelectorAll<HTMLElement>('[data-letter]')]
  const tagline = section.querySelector<HTMLElement>('[data-final-tagline]')!
  const cta = section.querySelector<HTMLElement>('[data-final-cta]')!
  const region = document.querySelector<HTMLElement>('[data-space-region]')!
  const { earth } = rigs
  const t = letters[3]!

  // Toute la scène se joue sur la nuit : barre d'en-tête sombre dès qu'elle la recouvre.
  theme(section, 'night')

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

  /**
   * La Terre entre le mot (remonté, réduit) et les actions, avec du jeu de part et d'autre, halo
   * compris : jamais de chevauchement, quel que soit l'écran. Rendu en échelle et décalage de la
   * pose (rigs.ts : disque de 2,5 rayons ajusté au plus petit côté de la fenêtre).
   */
  const globe = (mobile: boolean) => {
    const w = window.innerWidth
    const h = window.innerHeight
    const { lift, scale } = mobile ? STAGE.mobile : STAGE.desktop
    const stageBottom = stage.offsetTop + (stage.offsetHeight * (1 + scale)) / 2 - h * lift
    const gap = Math.max(20, h * 0.035)
    const room = cta.offsetTop - stageBottom - gap * 2
    const radius = Math.max(40, Math.min(room / 2 / 1.12, w * 0.42))
    return { scale: radius / (Math.min(w, h) / 2.5), y: stageBottom + gap + room / 2 - h / 2 }
  }

  mm.add({ mobile: '(max-width: 767px)', desktop: '(min-width: 768px)' }, (ctx) => {
    const mobile = !!ctx.conditions?.mobile
    const { lift, scale } = mobile ? STAGE.mobile : STAGE.desktop
    const tl = pinned(section)
    const W = () => section.clientWidth
    const H = () => section.clientHeight
    const barY = () => stem().y + stem().height / 2 - H() / 2

    tl.set(letters, { yPercent: 110 }, 0)
      .set(t, { yPercent: 0, autoAlpha: 0 }, 0)
      .set([tagline, cta], { autoAlpha: 0 }, 0)
      // La nuit montée avec la scène cède la place au même ciel, dans le décor (les étoiles
      // apparaissent) : le décor passe à l'espace dessous, invisible, puis le panneau s'efface.
      .fromTo(backdrop.w, { spaceIn: 0 }, { spaceIn: 1, duration: 0.005, onUpdate: backdrop.apply }, 0)
      .fromTo(night, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.07 }, 0.01)
      // Un trait orange traverse l'écran depuis la droite, à hauteur de la hampe du T…
      .fromTo(
        wipe,
        { autoAlpha: 1, scaleX: 0, scaleY: () => stem().width / H(), x: 0, y: barY },
        { scaleX: 1, duration: 0.1, ease: 'power2.inOut' },
        0.04,
      )
      // … puis se resserre exactement sur elle.
      .to(
        wipe,
        {
          scaleX: () => stem().width / W(),
          scaleY: () => stem().height / H(),
          x: () => stem().x + stem().width - W(),
          y: barY,
          duration: 0.13,
          ease: 'power3.inOut',
        },
        0.15,
      )
      .to(t, { autoAlpha: 1, duration: 0.03 }, 0.28)
      .to(wipe, { autoAlpha: 0, duration: 0.03 }, 0.29)
    ORDER.slice(1).forEach((i, k) => {
      tl.to(letters[i]!, { yPercent: 0, duration: 0.05, ease: 'power3.out' }, 0.31 + k * 0.022)
    })
    tl.fromTo(tagline, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.05 }, 0.5)

    // Zoom arrière : le mot monte, le sud du Bénin puis la Terre, entre le mot et les actions.
    tl.fromTo(stage, { y: 0, scale: 1 }, { y: () => -H() * lift, scale, duration: 0.16, ease: 'power2.inOut' }, 0.58)
      .fromTo(region, { autoAlpha: 0, scale: 1.6 }, { autoAlpha: 0.9, scale: 1, duration: 0.1 }, 0.6)
      .to(region, { scale: 0.45, duration: 0.14, ease: 'power1.in' }, 0.7)
      .to(region, { autoAlpha: 0, duration: 0.06 }, 0.78)
      .fromTo(
        earth.poses.zoom,
        { opacity: 0, scale: 3.2, y: 0 },
        {
          opacity: 1,
          scale: () => globe(mobile).scale,
          y: () => globe(mobile).y,
          duration: 0.2,
          ease: 'power2.out',
          onUpdate: earth.apply,
        },
        0.74,
      )
      .fromTo(cta, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.06, ease: 'power2.out' }, 0.88)
    end(tl)
  })

  // Scène 8 : le final remonte et s'efface, la Terre aussi ; la FAQ n'arrive qu'ensuite (global.css :
  // les questions commencent plus bas), sur le même ciel.
  const questions = document.querySelector<HTMLElement>('[data-scene="questions"]')
  if (questions) {
    theme(questions, 'night')
    invalidateOnResize(
      gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: questions, start: 'top bottom', end: 'top 55%', scrub: 0.6 },
      }),
    )
      .fromTo(section, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.8 }, 0)
      // La Terre monte avec la page (0,45 écran, la plage du fondu) : actions et globe partent d'un
      // bloc, sans se croiser.
      .fromTo(
        earth.poses.out,
        { opacity: 1, y: 0 },
        { opacity: 0, y: () => -window.innerHeight * 0.45, duration: 1, onUpdate: earth.apply },
        0,
      )
  }
}
