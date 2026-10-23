/**
 * Point d'entrée de la page : le mode est déjà posé sur <html> (script en ligne, lib/mode.ts). En
 * version réduite (ou sans JavaScript), rien ne s'anime : seule la teinte de l'en-tête suit les
 * sections. Les scènes sont créées dans l'ordre de la page (les épinglages se calculent ainsi).
 */
import { currentMode } from '@/lib/mode'
import { backdrop } from '@/lib/motion/backdrop'
import { gsap, ScrollTrigger, startEngine } from '@/lib/motion/engine'
import { headerTone } from '@/lib/motion/header-tone'
import { createRigs, load3D } from '@/lib/motion/rigs'
import { companies } from '@/lib/motion/scenes/companies'
import { final } from '@/lib/motion/scenes/final'
import { managers } from '@/lib/motion/scenes/managers'
import { opening } from '@/lib/motion/scenes/opening'
import { problem } from '@/lib/motion/scenes/problem'
import { route } from '@/lib/motion/scenes/route'
import { solution } from '@/lib/motion/scenes/solution'

headerTone()

const mode = currentMode()
if (mode !== 'reduced') {
  const motion = startEngine(mode)
  const rigs = createRigs(motion)
  backdrop.apply()
  rigs.phone.apply()
  rigs.city.apply()
  rigs.earth.apply()

  opening(motion)
  const mm = gsap.matchMedia()
  problem(rigs, mm)
  solution(rigs, mm)
  route(rigs, mm)
  managers(rigs, mm)
  companies(rigs)
  final(rigs, mm)

  // Ressources des scènes suivantes, chargées à leur approche (données mobiles chères) ou quand le
  // navigateur est libre : la ville et la 3D à l'approche de la scène 2, l'espace à la scène 6.
  const load = (selector: string) => {
    for (const img of document.querySelectorAll<HTMLImageElement>(selector)) {
      if (img.dataset.src && !img.src) img.src = img.dataset.src
    }
  }
  let started = false
  const prepare = () => {
    if (started) return
    started = true
    load('[data-city] img[data-src]')
    rigs.phone.preload()
    load3D(motion, rigs)
  }
  const prepareSpace = () => {
    load('[data-space-region][data-src]')
    // La Terre en 2D seulement sans globe 3D (mode léger, ou bascule en cours de route).
    if (motion.mode === 'lite') load('[data-space-earth][data-src]')
  }
  motion.onLite(() => load('[data-space-earth][data-src]'))
  ScrollTrigger.create({ trigger: '[data-scene="problem"]', start: 'top 200%', once: true, onEnter: prepare })
  ScrollTrigger.create({ trigger: '[data-scene="companies"]', start: 'top 200%', once: true, onEnter: prepareSpace })
  const idle = (fn: () => void, ms: number) =>
    window.setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(fn) : fn()), ms)
  idle(prepare, 6000)
  idle(prepareSpace, 12000)
}
