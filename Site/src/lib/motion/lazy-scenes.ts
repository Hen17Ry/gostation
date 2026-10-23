/**
 * Scènes 2 à 8 créées à l'approche du visiteur et détruites quand il est loin (storyboard §3) : au
 * chargement, seules l'ouverture et la scène suivante existent.
 *
 * Le rendu reste celui d'une page où tout serait créé d'emblée :
 *   - la mise en page ne bouge jamais : chaque enveloppe réserve en CSS la longueur de son
 *     épinglage (global.css) ;
 *   - une scène pas encore créée laisse ses éléments dans leur état d'avant le script, qui est son
 *     état de départ (CSS des modes animés, poses et facteurs du décor au repos) ;
 *   - détruite, une scène perd ses déclencheurs sans retour en arrière : ses éléments gardent l'état
 *     affiché (fin de scène si on l'a dépassée, départ si on ne l'a pas atteinte), seul son
 *     épinglage rend la place à l'espace réservé, identique. Recréée, elle annule d'abord sa
 *     version précédente. Si un saut fait passer le visiteur de l'autre côté d'une scène détruite,
 *     elle est recréée le temps d'être rendue dans le bon état ;
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
  live: Run | null
  /**
   * Scène détruite : ses animations, sans déclencheurs, gardent l'état affiché ; la prochaine
   * création les annule d'abord (chaque élément revient à son état d'origine).
   */
  dead: Run | null
  /** Scène détruite : le visiteur était avant elle (état de départ) ou après (état de fin). */
  side: Side | null
}
type Run = { mm: gsap.MatchMedia; ctx: gsap.Context; triggers: ScrollTrigger[] }
type Side = 'before' | 'after' | 'inside'

const sideOf = (scene: Scene): Side => {
  const r = scene.box.getBoundingClientRect()
  return r.top >= window.innerHeight ? 'before' : r.bottom <= 0 ? 'after' : 'inside'
}

/**
 * Pose les timelines de ces déclencheurs à l'avancement du défilement, sans l'amorti du scrub :
 * une scène créée par un saut, ou détruite, ne reste jamais figée à mi-course. Sans `force`,
 * seulement si l'amorti est à l'arrêt : un rafraîchissement le met en pause et ne le relance pas
 * toujours (scène dépassée puis retrouvée d'un saut), alors qu'un amorti en cours se poursuit.
 */
const settle = (triggers: ScrollTrigger[], force: boolean) => {
  for (const st of triggers) {
    // Sans scrub (apparitions jouées une fois), getTween() ne renvoie pas de tween (0).
    const scrub = st.getTween() as gsap.core.Tween | 0 | undefined
    if (!scrub || !st.animation || (!force && scrub.isActive())) continue
    scrub.pause()
    if (Math.abs(st.animation.progress() - st.progress) > 0.0005) st.animation.progress(st.progress)
  }
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
    scenes.push({ section, box, build, built: false, live: null, dead: null, side: null })
  }
  const byBox = new Map(scenes.map((s) => [s.box as Element, s]))
  const near = new Set<Scene>()
  const far = new Set<Scene>()

  const create = (scene: Scene) => {
    // L'ancienne version d'abord annulée (styles, poses, facteurs du décor d'origine) : la nouvelle
    // repart de l'état d'avant la scène et le rend à l'avancement du défilement, dans la même tâche.
    if (scene.dead) {
      scene.dead.mm.kill(true)
      scene.dead.ctx.kill(true)
      scene.dead = null
    }
    const before = new Set(ScrollTrigger.getAll())
    const mm = gsap.matchMedia()
    const ctx = gsap.context(() => scene.build(rigs, mm))
    scene.live = { mm, ctx, triggers: ScrollTrigger.getAll().filter((st) => !before.has(st)) }
    scene.built = true
  }

  const destroy = (scene: Scene) => {
    if (!scene.live) return
    ScrollTrigger.update()
    settle(scene.live.triggers, true)
    // Dernier avancement transmis aux objets partagés qu'elle pilote (écran du téléphone).
    for (const st of scene.live.triggers) st.vars.onUpdate?.(st)
    // Seuls les déclencheurs disparaissent (plus de calcul au défilement ni d'épinglage) ; les
    // animations restent, figées, pour être annulées proprement à la prochaine création.
    for (const st of scene.live.triggers) st.kill(false, true)
    scene.dead = scene.live
    scene.live = null
    // ScrollTrigger laisse l'épinglage en place : l'enveloppe retrouve son espace réservé (même
    // hauteur) et la scène sa place dans le flux, hors de l'écran.
    if (scene.box !== scene.section) gsap.set([scene.box, scene.section], { clearProps: 'all' })
    scene.side = sideOf(scene)
  }

  /**
   * Crée les scènes proches et, avant elles, celles qui n'ont jamais existé ; recrée aussi celles
   * dont le visiteur a changé de côté depuis leur destruction (saut), pour les rendre dans le bon état.
   */
  const sync = () => {
    const last = Math.max(-1, ...[...near].map((s) => scenes.indexOf(s)))
    // Position d'avant les créations : en se mesurant, les nouveaux épinglages annulent un instant
    // l'espace réservé de leur enveloppe, la page raccourcit et le navigateur peut ramener le
    // défilement plus haut ; on le remet où il était après le rafraîchissement.
    const y = window.scrollY
    // Choisies d'abord, toutes sur la mise en page d'avant (une création la change un instant).
    const created = scenes.filter((scene, i) => {
      if (scene.live) return false
      const wanted = i <= last && (near.has(scene) || !scene.built)
      const stale = scene.built && scene.side !== sideOf(scene)
      return wanted || stale
    })
    for (const scene of created) create(scene)
    if (!created.length) return
    // Un seul rafraîchissement : positions des nouveaux déclencheurs, et chaque scène rendue à son
    // avancement (fin de scène pour celles qu'on a dépassées), tout de suite.
    ScrollTrigger.refresh()
    if (Math.abs(window.scrollY - y) > 1) {
      window.scrollTo(0, y)
      ScrollTrigger.update()
    }
    // Posées aussi : les scènes vivantes hors de l'écran (leur amorti finirait après coup) ; la scène
    // visible garde le sien, sauf s'il est à l'arrêt.
    for (const scene of scenes) {
      if (!scene.live) continue
      settle(scene.live.triggers, created.includes(scene) || sideOf(scene) !== 'inside')
    }
    // Avancement transmis aux objets partagés pilotés par onUpdate (écran du téléphone, thème de
    // la barre), dont celui des scènes posées sans amorti.
    for (const scene of scenes) for (const st of scene.live?.triggers ?? []) st.vars.onUpdate?.(st)
  }

  /** Une passe, une fois les deux observateurs à jour : créations, puis destructions. */
  let pending = false
  const schedule = () => {
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      sync()
      for (const scene of scenes) if (scene.live && far.has(scene) && !near.has(scene)) destroy(scene)
    })
  }

  const nearby = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const scene = byBox.get(entry.target)
        if (!scene) continue
        if (entry.isIntersecting) near.add(scene)
        else near.delete(scene)
      }
      schedule()
    },
    { rootMargin: NEAR },
  )
  const distant = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const scene = byBox.get(entry.target)
        if (!scene) continue
        if (entry.isIntersecting) far.delete(scene)
        else far.add(scene)
      }
      schedule()
    },
    { rootMargin: FAR },
  )
  for (const scene of scenes) {
    nearby.observe(scene.box)
    distant.observe(scene.box)
  }
}
