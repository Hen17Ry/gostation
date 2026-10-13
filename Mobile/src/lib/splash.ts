import * as SplashScreen from 'expo-splash-screen'

/**
 * Écran de démarrage : masqué quand la session locale est lue **et**, si l'app s'ouvre sur la
 * carte, quand celle-ci a dessiné sa première image. La création de la carte et son premier rendu
 * font chuter les images au lancement (23 à 36 FPS sur le S10, cf. docs/performance.md) : ce creux
 * reste ainsi sous l'écran de démarrage. `MAX_WAIT_MS` borne l'attente (style ou tuiles lents).
 */
export const MAX_WAIT_MS = 2500

type Part = 'session' | 'map'

/** Porte de l'écran de démarrage : `hide` une seule fois, quand les deux conditions sont remplies. */
export function createSplashGate(hide: () => void, maxWaitMs = MAX_WAIT_MS) {
  const pending = new Set<Part>(['session', 'map'])
  let done = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const finish = () => {
    if (done) return
    done = true
    if (timer) clearTimeout(timer)
    hide()
  }
  /** Une condition est remplie ; `map` vaut aussi pour un démarrage sur un autre écran que la carte. */
  return (part: Part) => {
    pending.delete(part)
    if (part === 'session' && !timer) timer = setTimeout(finish, maxWaitMs)
    if (pending.size === 0) finish()
  }
}

export const splashReady = createSplashGate(() => void SplashScreen.hideAsync())
