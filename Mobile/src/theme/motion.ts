import { Easing } from 'react-native-reanimated'

/**
 * Mouvement (mêmes intentions que le web) : transform et opacité seulement, sur le thread UI
 * (Reanimated). Les ressorts donnent un retour naturel aux éléments manipulés au doigt. Avec
 * « réduire les animations » activé, les durées tombent à 0 (voir useMotion).
 */
export const duration = { fast: 120, base: 200, slow: 320 } as const

export const easing = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  in: Easing.bezier(0.4, 0, 1, 1),
} as const

export const spring = {
  /** Appui, petits éléments : vif, sans rebond visible. */
  snappy: { damping: 26, stiffness: 420, mass: 0.6 },
  /** Panneaux, cartes qui entrent : souple, un léger dépassement. */
  gentle: { damping: 22, stiffness: 220, mass: 1 },
} as const

/** Échelle d'un élément pressé (retour tactile visuel en < 120 ms, sans déplacer la mise en page). */
export const PRESSED_SCALE = 0.97
