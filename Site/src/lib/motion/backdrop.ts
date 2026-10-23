/**
 * Couleurs du fond fixe (storyboard §1) : chaque calque (orange, nuit, braise, espace) a une opacité
 * produit de facteurs, chacun animé par une seule scène (orangeIn par l'ouverture, orangeOut par le
 * problème…). Aucune scène n'anime la valeur d'une autre : défiler dans un sens ou dans l'autre,
 * ou sauter d'un lien, donne toujours le même mélange, et chaque passage est un fondu.
 */
import { gsap } from './engine'

const weights = { orangeIn: 0, orangeOut: 1, nightIn: 0, emberIn: 0, darkOut: 1, spaceIn: 0, spaceOut: 1 }
export type BackdropWeights = typeof weights

const layers = () => ({
  orange: document.querySelector<HTMLElement>('[data-bd="orange"]'),
  night: document.querySelector<HTMLElement>('[data-bd="night"]'),
  ember: document.querySelector<HTMLElement>('[data-bd="ember"]'),
  space: document.querySelector<HTMLElement>('[data-bd="space"]'),
})
let els: ReturnType<typeof layers> | null = null

export const backdrop = {
  w: weights,
  apply() {
    els ??= layers()
    const w = weights
    const set = (el: HTMLElement | null, v: number) => el && gsap.set(el, { autoAlpha: Math.max(0, Math.min(1, v)) })
    set(els.orange, w.orangeIn * w.orangeOut)
    set(els.night, w.nightIn * w.darkOut)
    set(els.ember, w.emberIn * w.darkOut)
    set(els.space, w.spaceIn * w.spaceOut)
  },
}

/** Signale un changement de thème de section (barre d'en-tête). */
export const themeChanged = () => document.dispatchEvent(new Event('gs:theme'))
