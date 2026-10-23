/**
 * Choix du mode d'animation, avant le premier rendu (script en ligne dans <head>, autorisé par son
 * empreinte dans la CSP) :
 *   - full : 3D, épinglages et scrub ;
 *   - lite : même histoire en 2D, Three.js jamais téléchargé (appareil modeste, économie de données,
 *     choix du visiteur mémorisé) ;
 *   - reduced : prefers-reduced-motion, état final de chaque scène, aucun mouvement.
 * `?mode=full|lite|reduced` force un mode (tests, vidéos). Le moteur peut encore passer de full à
 * lite (WebGL absent, images par seconde trop basses) : voir motion/engine.ts.
 */

export type MotionMode = 'full' | 'lite' | 'reduced'

export const MODE_STORAGE_KEY = 'gs-motion'

type ModeEnv = {
  location: { search: string }
  matchMedia: (query: string) => { matches: boolean }
  navigator: {
    deviceMemory?: number
    hardwareConcurrency?: number
    connection?: { saveData?: boolean }
  }
  localStorage?: { getItem: (key: string) => string | null }
}

/**
 * Autonome (aucune référence extérieure) : sa source est copiée telle quelle dans la page.
 * Seuils du storyboard : mémoire ≤ 3 Go, peu de cœurs (4 ou moins sur un écran tactile : un
 * téléphone d'entrée de gamme ; 2 ou moins ailleurs : un ordinateur à 4 cœurs fait tourner la 3D),
 * économie de données.
 */
export function detectMode(env: ModeEnv): 'full' | 'lite' | 'reduced' {
  const forced = /[?&]mode=(full|lite|reduced)\b/.exec(env.location.search)
  if (forced) return forced[1] as 'full' | 'lite' | 'reduced'
  if (env.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced'
  let stored: string | null
  try {
    stored = env.localStorage ? env.localStorage.getItem('gs-motion') : null
  } catch {
    stored = null // stockage indisponible (navigation privée, cookies bloqués)
  }
  if (stored === 'lite') return 'lite'
  const n = env.navigator
  const lowMemory = typeof n.deviceMemory === 'number' && n.deviceMemory <= 3
  const touch = env.matchMedia('(pointer: coarse)').matches
  const fewCores = typeof n.hardwareConcurrency === 'number' && n.hardwareConcurrency <= (touch ? 4 : 2)
  const saveData = !!(n.connection && n.connection.saveData)
  return lowMemory || fewCores || saveData ? 'lite' : 'full'
}

/** Script en ligne : pose `html.js` et `data-motion` avant le premier rendu. */
export const modeScript = `(function(){var d=document.documentElement;d.classList.add('js');try{d.dataset.motion=(${detectMode.toString()})(window)}catch(e){d.dataset.motion='reduced'}})();`

export function currentMode(): MotionMode {
  const m = document.documentElement.dataset.motion
  return m === 'full' || m === 'lite' ? m : 'reduced'
}
