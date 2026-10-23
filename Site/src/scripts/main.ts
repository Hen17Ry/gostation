/**
 * Point d'entrée de la page : le mode est déjà posé sur <html> (script en ligne, lib/mode.ts). En
 * version réduite (ou sans JavaScript), rien ne s'anime : seule la teinte de l'en-tête suit les
 * sections. Les scènes 2 à 8 sont créées à l'approche du visiteur (lib/motion/lazy-scenes.ts).
 */
import { currentMode } from '@/lib/mode'
import { backdrop } from '@/lib/motion/backdrop'
import { ScrollTrigger, startEngine } from '@/lib/motion/engine'
import { hasHardwareGpu } from '@/lib/motion/gpu'
import { headerTone } from '@/lib/motion/header-tone'
import { lazyScenes } from '@/lib/motion/lazy-scenes'
import { createRigs, load3D } from '@/lib/motion/rigs'
import { companies } from '@/lib/motion/scenes/companies'
import { final } from '@/lib/motion/scenes/final'
import { managers } from '@/lib/motion/scenes/managers'
import { opening } from '@/lib/motion/scenes/opening'
import { problem } from '@/lib/motion/scenes/problem'
import { route } from '@/lib/motion/scenes/route'
import { solution } from '@/lib/motion/scenes/solution'

headerTone()

const initial = currentMode()
// Le moteur démarre après le premier rendu complet : le titre (le LCP) ne l'attend pas, et le CSS
// d'avant le script donne déjà l'état de départ (croquis, bouteille et téléphone masqués, bandeau
// en bas).
if (initial !== 'reduced') requestAnimationFrame(() => setTimeout(() => animate(initial)))

function animate(requested: Exclude<typeof initial, 'reduced'>) {
  let mode = requested
  // Sans processeur graphique, la 3D bloquerait le fil principal : version légère d'emblée.
  if (mode === 'full' && !/[?&]mode=full\b/.test(location.search) && !hasHardwareGpu()) {
    mode = 'lite'
    document.documentElement.dataset.motion = 'lite'
    document.documentElement.dataset.degraded = 'gpu'
  }
  const motion = startEngine(mode)
  const rigs = createRigs(motion)
  backdrop.apply()
  rigs.phone.apply()
  rigs.city.apply()
  rigs.earth.apply()

  opening(motion)

  // Scènes 2 à 8 : créées à l'approche du visiteur, détruites quand il est loin.
  lazyScenes(rigs, [
    ['[data-scene="problem"]', problem],
    ['[data-scene="solution"]', solution],
    ['[data-scene="route"]', route],
    ['[data-scene="managers"]', managers],
    ['[data-scene="companies"]', companies],
    ['[data-scene="final"]', final],
  ])

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
