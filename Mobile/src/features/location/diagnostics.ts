import { create } from 'zustand'

/**
 * Diagnostic de la dernière localisation (Compte › Diagnostics, staging seulement) : délais et
 * précision, jamais de coordonnées. En mémoire seulement, comme la position.
 */
export interface LocateTiming {
  /** Délai d'affichage de la dernière position connue (null : aucune). */
  knownMs: number | null
  /** Délai de la nouvelle mesure (null : aucune à temps, ou pas nécessaire). */
  fixMs: number | null
  accuracyM: number | null
}

export const useLocateTiming = create<{ last: LocateTiming | null }>(() => ({ last: null }))
