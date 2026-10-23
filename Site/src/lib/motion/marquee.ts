/**
 * Bandeau défilant : dérive lente et continue, accélérée par la vitesse de défilement (dans son
 * sens) et inclinée (skewX) : l'équivalent en transform du flou de vitesse. La dérive s'arrête avec
 * le bouton Pause ; le défilement de la page, lui, fait toujours bouger le texte.
 *
 * Jointure sans raccord visible : chaque jeu se termine par son séparateur ; la boucle décale le
 * texte exactement du pas mesuré entre deux jeux consécutifs (sous-pixel compris), après le
 * chargement des polices et à chaque changement de taille (ResizeObserver), avec assez de copies
 * pour couvrir l'écran plus un pas. Le pas est publié dans data-loop (test de la jointure).
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
  let pitch = 0

  const build = () => {
    for (const clone of track.querySelectorAll('[data-clone]')) clone.remove()
    // Une copie d'abord, pour mesurer le pas réel (début du jeu 2 − début du jeu 1).
    const probe = group.cloneNode(true) as HTMLElement
    probe.dataset.clone = ''
    track.append(probe)
    const next = probe.getBoundingClientRect().left - group.getBoundingClientRect().left
    if (next <= 0) return
    const copies = Math.ceil(window.innerWidth / next) + 1
    for (let i = 1; i < copies; i++) {
      const clone = group.cloneNode(true) as HTMLElement
      clone.dataset.clone = ''
      track.append(clone)
    }
    // Inclinaison (skewX) : identique pour tous les jeux, elle ne fausse pas la différence.
    const changed = Math.abs(next - pitch) > 0.01
    pitch = next
    track.dataset.loop = pitch.toFixed(3)
    if (!changed && loop) return
    const progress = loop ? loop.totalTime() / loop.duration() : 1000
    loop?.kill()
    loop = gsap.fromTo(track, { x: 0 }, { x: -pitch, duration: pitch / DRIFT, ease: 'none', repeat: -1 })
    // Départ loin de zéro : le bandeau peut repartir en arrière (défilement vers le haut).
    loop.totalTime(progress * loop.duration())
  }

  // Mesure seulement avec la police d'affichage chargée (une police de repli fausserait le pas).
  const fontsReady = document.fonts
    ? Promise.all([document.fonts.load('800 100px "Bricolage Grotesque"'), document.fonts.ready]).catch(() => undefined)
    : Promise.resolve()
  void fontsReady.then(() => {
    build()
    // Taille du jeu modifiée (rotation de l'écran, zoom du texte, police tardive) : nouvelle mesure.
    let frame = 0
    new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(build)
    }).observe(group)
    window.addEventListener('resize', () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(build)
    })
  })

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
