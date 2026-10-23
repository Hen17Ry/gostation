/**
 * Point d'entrée de la page : le mode est déjà posé sur <html> (script en ligne, lib/mode.ts). En
 * version réduite (ou sans JavaScript), rien ne s'anime et ce module s'arrête là.
 */
import { currentMode } from '@/lib/mode'
import { startEngine } from '@/lib/motion/engine'
import { opening } from '@/lib/motion/scenes/opening'

const mode = currentMode()
if (mode !== 'reduced') {
  const motion = startEngine(mode)
  opening(motion)
}
