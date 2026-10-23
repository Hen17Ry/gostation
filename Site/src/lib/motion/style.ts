/**
 * Écritures de style directes pour les décors recomposés à chaque image (fond, ville, téléphone,
 * Terre) : gsap.set crée une tween et relit les styles calculés à chaque appel (recalcul forcé de
 * toute la page) ; ici, une simple écriture, et seulement quand la valeur change. Réservé aux
 * éléments qu'aucune tween n'anime par ailleurs.
 */
type Written = { alpha?: number; transform?: string }
const written = new WeakMap<HTMLElement, Written>()

const cache = (el: HTMLElement) => {
  let c = written.get(el)
  if (!c) written.set(el, (c = {}))
  return c
}

const round = (v: number, step = 1000) => Math.round(v * step) / step

/** Comme autoAlpha de GSAP : opacité, et visibility: hidden à 0 (ni rendu ni clics). */
export function setAlpha(el: HTMLElement, value: number) {
  const alpha = round(Math.max(0, Math.min(1, value)))
  const c = cache(el)
  if (c.alpha === alpha) return
  c.alpha = alpha
  el.style.opacity = String(alpha)
  el.style.visibility = alpha === 0 ? 'hidden' : 'inherit'
}

/** Visibilité imposée hors de setAlpha (bascule 2D/3D) : le prochain setAlpha réécrit tout. */
export function setVisibility(el: HTMLElement, visibility: 'hidden' | 'visible') {
  el.style.visibility = visibility
  delete cache(el).alpha
}

/** Transformation (px, degrés), dans l'ordre de GSAP : translation, rotations Y puis X, échelle. */
export function setTransform(el: HTMLElement, x: number, y: number, scale = 1, rotY = 0, rotX = 0) {
  let transform = `translate3d(${round(x, 100)}px, ${round(y, 100)}px, 0px)`
  if (rotY) transform += ` rotateY(${round(rotY, 100)}deg)`
  if (rotX) transform += ` rotateX(${round(rotX, 100)}deg)`
  if (scale !== 1) transform += ` scale(${round(scale, 10000)})`
  const c = cache(el)
  if (c.transform === transform) return
  c.transform = transform
  el.style.transform = transform
}
