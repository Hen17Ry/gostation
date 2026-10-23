/**
 * Scène 1 — Ouverture (docs/landing/storyboard.md) : le croquis de la bouteille se trace, se
 * « remplit » et devient objet (3D en mode complet, 2D en mode léger), le bandeau monte et défile ;
 * au défilement, la bouteille pivote, puis le bandeau inonde l'écran et la bouteille s'y enfonce.
 * Le passage est court : dès que l'orange couvre l'écran, le décor fixe prend le relais (même
 * orange) et le titre de la scène 2 arrive dessus.
 */
import { FRAME, SVG_SCALE, TILT } from '../../bottle'
import { backdrop } from '../backdrop'
import { gsap, invalidateOnResize, ScrollTrigger, type Motion } from '../engine'
import { marquee } from '../marquee'
import { spacerOf } from './common'

type Bottle3D = import('../../webgl/opening-bottle').OpeningBottle

const FRAME_HEIGHT = FRAME.top - FRAME.bottom
/** Hauteur de remplissage → position verticale dans le repère SVG du croquis. */
const svgY = (fillY: number) => (FRAME.top - fillY * Math.cos(TILT)) * SVG_SCALE

export function opening(motion: Motion) {
  const section = document.querySelector<HTMLElement>('[data-scene="opening"]')
  if (!section) return
  const q = <T extends Element = HTMLElement>(sel: string) => section.querySelector<T>(sel)
  const qa = <T extends Element = SVGPathElement>(sel: string) => [...section.querySelectorAll<T>(sel)]

  const copy = q('[data-opening-copy]')!
  const art = q('[data-bottle-art]')!
  const stageEl = q('[data-bottle-stage]')!
  const sketch = q<SVGSVGElement>('[data-bottle-sketch]')!
  const solid = q<SVGSVGElement>('[data-bottle-solid]')!
  const sketchMask = q<SVGRectElement>('[data-sketch-mask]')!
  const solidClip = q<SVGRectElement>('[data-solid-clip]')!
  const band = q('[data-band]')!
  const bandBg = q('[data-band-bg]')!
  const bandText = q('[data-band-text]')!
  const shadow = q('[data-bottle-shadow]')
  const construction = qa('[data-stroke="construction"]')
  const outline = qa('[data-stroke="outline"]')
  const detail = qa('[data-stroke="detail"]')
  const notes = qa<SVGGElement>('[data-stroke="note"]')
  const canvas = document.querySelector<HTMLCanvasElement>('[data-webgl]')

  // ── État initial (les mêmes valeurs que le CSS d'avant le script) ──────────────────────────
  gsap.set([...construction, ...outline, ...detail], { drawSVG: '0%' })
  gsap.set(notes, { autoAlpha: 0 })
  gsap.set(sketch, { autoAlpha: 1 })
  gsap.set(solid, { autoAlpha: motion.mode === 'lite' ? 1 : 0 })
  // y: 0 efface la translation du CSS d'avant le script (GSAP l'ajouterait au yPercent).
  gsap.set(band, { y: 0, yPercent: 101 })
  // Le titre, le chapeau et les actions sont visibles dès le premier rendu (le titre est le LCP) :
  // seuls le croquis, la bouteille et le bandeau font leur entrée.
  document.documentElement.classList.add('motion-ready')

  // ── Remplissage : une seule valeur pilote la 3D, le masque du croquis et la découpe 2D ─────
  let bottle: Bottle3D | null = null
  const fill = { y: -0.35 }
  const setMask = (y: number) => gsap.set(sketchMask, { y: svgY(y) - FRAME_HEIGHT * SVG_SCALE })
  const setClip = (y: number) => gsap.set(solidClip, { y: svgY(y) })
  const applyFill = () => {
    setMask(fill.y)
    if (motion.mode === 'lite') setClip(fill.y)
    else if (bottle) {
      bottle.model.uniforms.uFillY.value = fill.y
      bottle.stage.invalidate()
    }
    if (shadow) gsap.set(shadow, { opacity: gsap.utils.clamp(0, 1, (fill.y + 0.3) / 0.6) })
  }
  applyFill()
  setClip(fill.y)

  // ── Position de la bouteille : rotation au repos + timeline de défilement ─────────────────
  const state = { idle: 0, turn: 0, lift: 0, scale: 1, sink: 0 }
  // Repère mesuré dans la section épinglée (une unité = rayon du corps).
  const geo = { unit: 1, originX: 0, originY: 0 }
  let pinTrigger: ScrollTrigger | null = null

  const measure = () => {
    const s = section.getBoundingClientRect()
    const r = stageEl.getBoundingClientRect()
    geo.unit = r.height / FRAME_HEIGHT
    geo.originX = r.left - s.left + -FRAME.left * geo.unit
    geo.originY = r.top - s.top + FRAME.top * geo.unit
  }

  /** Haut de la section dans la fenêtre : 0 pendant l'épinglage, puis elle remonte. */
  const sectionTop = () => {
    const st = pinTrigger
    if (!st) return section.getBoundingClientRect().top
    const scroll = st.scroll()
    return scroll < st.start ? st.start - scroll : scroll > st.end ? st.end - scroll : 0
  }

  const setArt = {
    y: gsap.quickSetter(art, 'y', 'px') as (v: number) => void,
    scale: gsap.quickSetter(art, 'scale') as (v: number) => void,
  }

  const apply = () => {
    const lift = (-state.lift + state.sink * 1.9) * geo.unit
    const scale = state.scale * (1 - 0.5 * state.sink)
    // Ombre de contact : plus petite et plus pâle quand la bouteille monte, absente quand elle s'enfonce.
    if (shadow && fill.y > 0.3) {
      const away = state.lift / 0.1
      gsap.set(shadow, { opacity: (1 - 0.55 * away) * (1 - state.sink), scaleX: 1 - 0.25 * away })
    }
    if (motion.mode === 'full' && bottle) {
      const { root, spin } = bottle.model
      root.position.set(geo.originX, -(sectionTop() + geo.originY + lift), 0)
      root.scale.setScalar(geo.unit * scale)
      spin.rotation.y = state.idle + state.turn
      bottle.stage.show(bottle.layer, state.sink < 0.999 && inView)
      bottle.stage.invalidate()
    } else {
      setArt.y(lift)
      setArt.scale(scale)
    }
  }

  // Rotation au repos (un tour en 16 s), en pause avec le bouton ou hors écran.
  let idle: gsap.core.Tween | null = null
  let releaseHold: (() => void) | null = null
  let inView = true
  const syncIdle = () => {
    const run = inView && !motion.paused && motion.mode === 'full' && !!bottle && fill.y >= (bottle?.fullFill ?? 0)
    if (run && !idle) {
      idle = gsap.to(state, { idle: `+=${Math.PI * 2}`, duration: 16, ease: 'none', repeat: -1, onUpdate: apply })
      releaseHold = bottle!.stage.hold()
    } else if (!run && idle) {
      idle.kill()
      idle = null
      releaseHold?.()
      releaseHold = null
    }
  }
  motion.onPause(syncIdle)

  // Mode léger : flottaison douce au lieu de la rotation (mêmes règles de pause).
  let float: gsap.core.Tween | null = null
  const syncFloat = () => {
    const run = inView && !motion.paused && motion.mode === 'lite' && fill.y > 3
    if (run && !float) float = gsap.to(stageEl, { y: -5, duration: 2.4, ease: 'sine.inOut', yoyo: true, repeat: -1 })
    else if (!run && float) {
      float.kill()
      float = null
      gsap.to(stageEl, { y: 0, duration: 0.4 })
    }
  }
  motion.onPause(syncFloat)

  // ── Passage au mode léger en cours de route ───────────────────────────────────────────────
  motion.onLite(() => {
    syncIdle()
    if (bottle) bottle.stage.show(bottle.layer, false)
    setClip(Math.max(fill.y, 0))
    gsap.to(solid, { autoAlpha: 1, duration: 0.5 })
    apply()
    syncFloat()
  })

  // ── Intro au chargement ───────────────────────────────────────────────────────────────────
  const intro = gsap.timeline({ delay: 0.15 })
  intro
    .to(construction, { drawSVG: '100%', duration: 0.7, stagger: 0.08, ease: 'power2.inOut' }, 0)
    .to(outline, { drawSVG: '100%', duration: 1, stagger: 0.14, ease: 'power2.inOut' }, 0.25)
    .to(detail, { drawSVG: '100%', duration: 0.55, stagger: 0.06, ease: 'power1.inOut' }, 0.85)
    .to(notes, { autoAlpha: 1, duration: 0.35, stagger: 0.12 }, 1.15)
    .to(band, { yPercent: 0, duration: 0.9, ease: 'expo.out' }, 0.7)

  const fillTo = (duration: number) =>
    gsap.to(fill, {
      y: bottle?.fullFill ?? 3.6,
      duration,
      ease: 'power2.inOut',
      onUpdate: applyFill,
      onComplete: () => {
        gsap.to(notes, { autoAlpha: 0, duration: 0.5 })
        gsap.to(sketch, { autoAlpha: 0, duration: 0.6, delay: 0.1 })
        syncIdle()
        syncFloat()
        if (motion.mode === 'full' && bottle) {
          // Fluidité réelle mesurée pendant la rotation : sous 40 images/s, mode léger.
          bottle.stage.measureFps().then((verdict) => verdict === 'slow' && motion.degradeToLite('fps'))
        }
      },
    })

  const ready: Promise<void> =
    motion.mode === 'full' && canvas
      ? import('../../webgl/opening-bottle')
          .then(({ loadOpeningBottle }) => loadOpeningBottle(canvas, () => motion.degradeToLite('context-lost')))
          .then((b) => {
            bottle = b
            measure()
            apply()
            applyFill()
          })
          .catch(() => motion.degradeToLite('webgl'))
      : Promise.resolve()

  // Le remplissage part à 1,6 s, ou dès que la 3D est prête si elle arrive plus tard.
  intro.call(() => void ready.then(() => fillTo(1.3)), [], 1.6)

  // ── Défilement : épinglage et scrub ───────────────────────────────────────────────────────
  const mm = gsap.matchMedia()
  mm.add({ mobile: '(max-width: 767px)', desktop: '(min-width: 768px)' }, (ctx) => {
    const mobile = !!ctx.conditions?.mobile
    const scroll = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: () => `+=${window.innerHeight * (mobile ? 0.8 : 1)}`,
        pin: true,
        pinSpacer: spacerOf(section),
        scrub: 0.8,
        onRefresh: () => {
          measure()
          apply()
        },
        onUpdate: apply,
        onToggle: (self) => {
          inView = self.isActive || self.progress < 1
          if (bottle) bottle.stage.show(bottle.layer, inView && state.sink < 0.999)
          syncIdle()
          syncFloat()
        },
      },
    })
    invalidateOnResize(scroll)
    pinTrigger = scroll.scrollTrigger ?? null

    scroll
      .to(copy, { y: -64, autoAlpha: 0, duration: 0.3 }, 0)
      .to(state, { turn: (Math.PI * 2) / 3, lift: 0.1, scale: 1.03, duration: 0.42, onUpdate: apply }, 0)
      // L'orange envahit l'écran, la bouteille s'y enfonce ; sans temps mort.
      .to(
        bandBg,
        { scaleY: () => window.innerHeight / Math.max(1, band.offsetHeight), duration: 0.5, ease: 'power2.in' },
        0.42,
      )
      .to(bandText, { yPercent: -50, autoAlpha: 0, duration: 0.3, ease: 'power1.in' }, 0.45)
      .to(state, { sink: 1, duration: 0.42, ease: 'power2.in', onUpdate: apply }, 0.45)
      // Une fois l'écran couvert, le décor fixe prend le même orange (invisible sous le bandeau).
      .to(backdrop.w, { orangeIn: 1, duration: 0.06, onUpdate: backdrop.apply }, 0.92)

    return () => {
      pinTrigger = null
    }
  })

  marquee(band, motion)
}
