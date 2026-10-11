import { fr } from './fr'

export type { Messages } from './fr'
export { errorMessage } from './errors'

/** Dictionnaire courant. Français seul en V1 ; `en` s'ajoutera derrière le même type. */
export const t = fr
export const locale = 'fr-FR'
