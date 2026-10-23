/**
 * Scènes 2 à 8 créées à l'approche du visiteur et détruites quand il est loin (storyboard §3) : au
 * chargement, seules l'ouverture et la scène suivante existent.
 *
 * Le rendu reste celui d'une page où tout serait créé d'emblée :
 *   - la mise en page ne bouge jamais : chaque enveloppe réserve en CSS la longueur de son
 *     épinglage (global.css) ;
 *   - une scène pas encore créée laisse ses éléments dans leur état d'avant le script, qui est son
 *     état de départ (CSS des modes animés, poses et facteurs du décor au repos) ;
 *   - détruite, une scène est tuée sans retour en arrière : ses éléments gardent l'état affiché
 *     (fin de scène si on l'a dépassée, départ si on ne l'a pas atteinte), seul son épinglage
 *     rend la place à l'espace réservé, identique ;
 *   - une scène n'est jamais créée avant que les précédentes l'aient été une fois, dans l'ordre :
 *     après un saut (lien, rechargement en milieu de page), les décors partagés (fond, ville,
 *     téléphone, Terre) sont dans l'état que leur ont laissé les scènes d'avant.
 */
import { gsap, ScrollTrigger } from './engine'
import type { Rigs } from './rigs'

export type SceneBuild = (rigs: Rigs, mm: gsap.MatchMedia) => void

type Scene = {
  section: HTMLElement
  /** Ce qu'on observe : l'enveloppe d'épinglage (toute la longueur de la scène) ou la section. */
  box: HTMLElement
  build: SceneBuild
  built: boolean
  live: { mm: gsap.MatchMedia; ctx: gsap.Context } | null
}

/** Création à 1,5 écran de la fenêtre ; destruction au-delà de 3 écrans. */
const NEAR = '150% 0px'
const FAR = '300% 0px'

export function lazyScenes(rigs: Rigs, list: [selector: string, build: SceneBuild][]) {
  const scenes: Scene[] = []
  for (const [selector, build] of list) {
    const section = document.querySelector<HTMLElement>(selector)
    if (!section) continue
    const box = section.closest<HTMLElement>('[data-pin]') ?? section
    scenes.push({ section, box, build, built: false, live: null })
  }
  const byBox = new Map(scenes.map((s) => [s.box as Element, s]))
  const near = new Set<Scene>()

  const create = (scene: Scene) => {
    const mm = gsap.matchMedia()
    const ctx = gsap.context(() => scene.build(rigs, mm))
    scene.live = { mm, ctx }
    scene.built = true
  }

  const destroy = (scene: Scene) => {
    if (!scene.live) return
    scene.live.mm.kill(false)
    scene.live.ctx.kill(false)
    scene.live = null
    // ScrollTrigger laisse l'épinglage en place : l'enveloppe retrouve son espace réservé (même
    // hauteur) et la scène sa place dans le flux, hors de l'écran.
    if (scene.box !== scene.section) gsap.set([scene.box, scene.section], { clearProps: 'all' })
  }

  /** Crée les scènes proches et, avant elles, celles qui n'ont jamais existé. */
  const sync = () => {
    const last = Math.max(-1, ...[...near].map((s) => scenes.indexOf(s)))
    let created = false
    for (const [i, scene] of scenes.entries()) {
      if (i > last) break
      if (scene.live || (scene.built && !near.has(scene))) continue
      create(scene)
      created = true
    }
    // Un seul rafraîchissement : positions des nouveaux déclencheurs, et chaque scène rendue à son
    // avancement (fin de scène pour celles qu'on a dépassées).
    if (created) ScrollTrigger.refresh()
  }

  const nearby = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const scene = byBox.get(entry.target)
        if (!scene) continue
        if (entry.isIntersecting) near.add(scene)
        else near.delete(scene)
      }
      sync()
    },
    { rootMargin: NEAR },
  )
  const distant = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const scene = byBox.get(entry.target)
        if (scene && !entry.isIntersecting && !near.has(scene)) destroy(scene)
      }
    },
    { rootMargin: FAR },
  )
  for (const scene of scenes) {
    nearby.observe(scene.box)
    distant.observe(scene.box)
  }
}
