/**
 * Bandeau défilant : dérive lente et continue, accélérée par la vitesse de défilement (dans son
 * sens) et inclinée (skewX) — l'équivalent en transform du flou de vitesse. La dérive s'arrête avec
 * le bouton Pause ; le défilement de la page, lui, fait toujours bouger le texte.
 */
import { gsap, ScrollTrigger, type Motion } from './engine'

/** Vitesse de dérive (px/s) et plafond de l'inclinaison (degrés). */
const DRIFT = 42
const MAX_SKEW = 8

export function marquee(band: HTMLElement, motion: Motion) {
  const track = band.querySelector<HTMLElement>('[data-marquee-track]')
  const group = track?.firstElementChild as HTMLElement | null
  if (!track || !group) return

  let loop: gsap.core.Tween | null = null
  const build = () => {
    // Assez de copies pour couvrir l'écran plus une longueur de groupe (bouclage sans trou).
    for (const clone of track.querySelectorAll('[data-clone]')) clone.remove()
    // Largeur de mise en page (offsetWidth) : l'inclinaison du bandeau ne la fausse pas.
    const width = group.offsetWidth
    if (!width) return
    const copies = Math.ceil(window.innerWidth / width) + 1
    for (let i = 0; i < copies; i++) {
      const clone = group.cloneNode(true) as HTMLElement
      clone.dataset.clone = ''
      track.append(clone)
    }
    const progress = loop?.totalTime() ?? 0
    loop?.kill()
    loop = gsap.fromTo(track, { x: 0 }, { x: -width, duration: width / DRIFT, ease: 'none', repeat: -1 })
    // Départ loin de zéro : le bandeau peut repartir en arrière (défilement vers le haut).
    loop.totalTime(progress || (width / DRIFT) * 1000)
  }
  build()
  ScrollTrigger.addEventListener('refreshInit', build)

  const skew = gsap.quickSetter(track, 'skewX', 'deg') as (v: number) => void
  let base = motion.paused ? 0 : 1
  let boost = 0
  let target = 0
  let direction = 1
  let visible = true

  motion.onPause((paused) => {
    base = paused ? 0 : 1
  })

  ScrollTrigger.create({
    trigger: band,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      visible = self.isActive
    },
    onUpdate: (self) => {
      const v = self.getVelocity()
      if (Math.abs(v) > 30) direction = Math.sign(v)
      target = gsap.utils.clamp(-14, 14, v / 260)
    },
  })

  gsap.ticker.add(() => {
    if (!visible || !loop) return
    boost += (target - boost) * 0.12
    target *= 0.9
    loop.timeScale(direction * (base + Math.abs(boost)))
    skew(gsap.utils.clamp(-MAX_SKEW, MAX_SKEW, -boost * 1.1))
  })
}
