/**
 * Moteur d'animation du site : GSAP (ScrollTrigger, SplitText, DrawSVG), Lenis pour la molette,
 * une seule boucle requestAnimationFrame (le ticker de GSAP). Rien n'est chargé en version réduite.
 */
import { gsap } from 'gsap'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import Lenis from 'lenis'

import { MODE_STORAGE_KEY, type MotionMode } from '../mode'

gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin, MotionPathPlugin)

export { DrawSVGPlugin, gsap, ScrollTrigger, SplitText }

type PauseListener = (paused: boolean) => void

/** État partagé par les scènes : mode courant, pause des mouvements automatiques (WCAG 2.2.2). */
class Motion {
  mode: Exclude<MotionMode, 'reduced'>
  paused = false
  lenis: Lenis | null = null
  private pauseListeners = new Set<PauseListener>()
  private liteListeners = new Set<() => void>()

  constructor(mode: Exclude<MotionMode, 'reduced'>) {
    this.mode = mode
  }

  get isMobile() {
    return window.matchMedia('(max-width: 767px)').matches
  }

  onPause(fn: PauseListener) {
    this.pauseListeners.add(fn)
    fn(this.paused)
  }

  setPaused(paused: boolean) {
    this.paused = paused
    for (const fn of this.pauseListeners) fn(paused)
  }

  /** Passage au mode léger en cours de route (WebGL absent, images par seconde trop basses). */
  onLite(fn: () => void) {
    this.liteListeners.add(fn)
  }

  degradeToLite(reason: string) {
    if (this.mode === 'lite') return
    this.mode = 'lite'
    document.documentElement.dataset.motion = 'lite'
    document.documentElement.dataset.degraded = reason
    for (const fn of this.liteListeners) fn()
  }

  /** Choix explicite du visiteur (lien « Version légère »), mémorisé. */
  static remember(mode: 'lite' | null) {
    try {
      if (mode) localStorage.setItem(MODE_STORAGE_KEY, mode)
      else localStorage.removeItem(MODE_STORAGE_KEY)
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour cette page seulement.
    }
  }
}

export type { Motion }

export function startEngine(mode: Exclude<MotionMode, 'reduced'>): Motion {
  const motion = new Motion(mode)

  // Barre d'adresse mobile : pas de recalcul à chaque apparition ou disparition.
  ScrollTrigger.config({ ignoreMobileResize: true })
  gsap.ticker.lagSmoothing(500, 33)

  // Molette lissée sur ordinateur ; au doigt, défilement natif (syncTouch désactivé).
  const lenis = new Lenis({ autoRaf: false, anchors: { offset: 0 }, lerp: 0.12 })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((time) => lenis.raf(time * 1000))
  motion.lenis = lenis

  // Onglet caché : la boucle de rendu du navigateur s'arrête d'elle-même ; on fige aussi Lenis.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lenis.stop()
    else lenis.start()
  })

  // Les polices changent la mise en page (titres, bandeau) : positions recalculées une fois prêtes.
  document.fonts?.ready.then(() => ScrollTrigger.refresh())

  wireMotionToggles(motion)
  return motion
}

/** Boutons « Pause » des mouvements automatiques (rotation, bandeau défilant). */
function wireMotionToggles(motion: Motion) {
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]')
  for (const button of buttons) {
    button.hidden = false
    button.addEventListener('click', () => motion.setPaused(!motion.paused))
  }
  motion.onPause((paused) => {
    for (const button of buttons) {
      button.setAttribute('aria-label', paused ? 'Reprendre les animations' : 'Mettre les animations en pause')
      button.dataset.state = paused ? 'paused' : 'playing'
    }
  })
}
