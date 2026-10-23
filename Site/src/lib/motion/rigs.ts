/**
 * Les objets partagés par plusieurs scènes, pilotés par des « poses » : chaque scène anime la
 * sienne (entrée, déplacement, pivot, sortie…) et l'objet affiché est leur composition (décalages
 * additionnés, échelles multipliées). Aucune scène n'anime la valeur d'une autre : on peut
 * défiler dans les deux sens ou sauter d'un lien, l'état reste juste.
 *   - téléphone : 3D (mode complet) ou HTML (mode léger), même pose, même écran peint ;
 *   - ville : opacité et caméra (zoom, cadrage) de la carte de Cotonou ;
 *   - Terre : échelle et opacité du disque de l'espace (SVG en léger, globe 3D en complet).
 */
import { createScreenCanvas, loadMap, paint, screenKey, type Screen } from '../phone/painter'
import type { PhoneModel } from '../webgl/phone-model'
import type { Layer, Stage } from '../webgl/stage'
import type { Motion } from './engine'
import { setAlpha, setTransform, setVisibility } from './style'

export type Pose = { x: number; y: number; scale: number; rotY: number; rotX: number; opacity: number }
export const pose = (p: Partial<Pose> = {}): Pose => ({ x: 0, y: 0, scale: 1, rotY: 0, rotX: 0, opacity: 1, ...p })

function compose(poses: Pose[]): Pose {
  return poses.reduce(
    (a, p) => ({
      x: a.x + p.x,
      y: a.y + p.y,
      scale: a.scale * p.scale,
      rotY: a.rotY + p.rotY,
      rotX: a.rotX + p.rotX,
      opacity: a.opacity * p.opacity,
    }),
    pose(),
  )
}

// ── Téléphone ─────────────────────────────────────────────────────────────────────────────────
type Phone3D = { stage: Stage; layer: Layer; model: PhoneModel; textureCanvas: HTMLCanvasElement }

export class PhoneRig {
  readonly poses = {
    enter: pose({ opacity: 0 }),
    move: pose(),
    flip: pose(),
    out: pose(),
  }
  private screen: Screen = { kind: 'search', product: null, size: null }
  private key = ''
  private three: Phone3D | null = null
  private anchor = { cx: 0, cy: 0, height: 1 }
  private readonly box = document.querySelector<HTMLElement>('[data-phone]')!
  private readonly body = document.querySelector<HTMLElement>('[data-phone-body]')!
  private readonly domCanvas = document.querySelector<HTMLCanvasElement>('[data-phone-screen]')!

  constructor(private readonly motion: Motion) {
    this.measure()
    window.addEventListener('resize', () => this.measure())
    motion.onLite(() => this.useDom())
  }

  get canvas() {
    return this.three?.textureCanvas ?? this.domCanvas
  }

  /** Bascule sur le téléphone 3D (mode complet), qui reprend la pose et l'écran. */
  attach3D(three: Phone3D) {
    if (this.motion.mode !== 'full') return
    this.three = three
    setVisibility(this.body, 'hidden')
    this.key = ''
    this.repaint()
    this.apply()
  }

  private useDom() {
    if (this.three) {
      this.three.stage.show(this.three.layer, false)
      this.three = null
    }
    setVisibility(this.body, 'visible')
    this.key = ''
    this.repaint()
    this.apply()
  }

  measure() {
    const r = this.box.getBoundingClientRect()
    this.anchor = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, height: r.height }
    this.apply()
  }

  /** Carte de l'écran (fond clair de l'app) : chargée à l'approche des scènes du téléphone. */
  preload() {
    void loadMap().then(() => {
      this.key = ''
      this.repaint()
    })
  }

  setScreen(screen: Screen) {
    this.screen = screen
    this.repaint()
  }

  private repaint() {
    const k = screenKey(this.screen)
    if (k === this.key) return
    this.key = k
    paint(this.canvas, this.screen)
    if (this.three) {
      this.three.model.screen.needsUpdate = true
      this.three.stage.invalidate()
    }
  }

  apply = () => {
    const p = compose([this.poses.enter, this.poses.move, this.poses.flip, this.poses.out])
    const visible = p.opacity > 0.01
    if (this.three) {
      const { model, stage, layer } = this.three
      model.root.position.set(this.anchor.cx + p.x, -(this.anchor.cy + p.y), 0)
      model.root.scale.setScalar((this.anchor.height / 1.6) * p.scale)
      model.root.rotation.set((p.rotX * Math.PI) / 180, (p.rotY * Math.PI) / 180, 0)
      stage.show(layer, visible)
      stage.invalidate()
      return
    }
    setTransform(this.body, p.x, p.y, p.scale, p.rotY, p.rotX)
    setAlpha(this.body, p.opacity)
  }
}

// ── Ville ─────────────────────────────────────────────────────────────────────────────────────
export class CityRig {
  readonly poses = { in: pose({ opacity: 0 }), cam: pose(), out: pose() }
  private readonly layer = document.querySelector<HTMLElement>('[data-bd-city]')!
  private readonly map = document.querySelector<HTMLElement>('[data-city]')!

  apply = () => {
    const p = compose([this.poses.in, this.poses.cam, this.poses.out])
    setAlpha(this.layer, p.opacity)
    setTransform(this.map, p.x, p.y, p.scale)
  }

  /** Point de la carte (unités) → point de l'écran, carte au repos (object-fit: cover). */
  toScreen([mx, my]: readonly number[], size: { width: number; height: number }) {
    const w = window.innerWidth
    const h = window.innerHeight
    const s = Math.max(w / size.width, h / size.height)
    return [(w - size.width * s) / 2 + mx! * s, (h - size.height * s) / 2 + my! * s] as const
  }
}

// ── Terre ─────────────────────────────────────────────────────────────────────────────────────
export class EarthRig {
  readonly poses = { zoom: pose({ opacity: 0, scale: 3 }), out: pose() }
  private globe: { stage: Stage; layer: Layer; root: import('three').Group } | null = null
  private readonly svg = document.querySelector<HTMLElement>('[data-space-earth]')!

  attach3D(globe: { stage: Stage; layer: Layer; root: import('three').Group }) {
    this.globe = globe
    setVisibility(this.svg, 'hidden')
    this.apply()
  }

  detach3D() {
    if (!this.globe) return
    this.globe.stage.show(this.globe.layer, false)
    this.globe = null
    setVisibility(this.svg, 'visible')
    this.apply()
  }

  apply = () => {
    const p = compose([this.poses.zoom, this.poses.out])
    if (this.globe) {
      const { stage, layer, root } = this.globe
      const w = window.innerWidth
      const h = window.innerHeight
      // Même disque que l'illustration 2D : viewBox de 2,5 rayons, ajusté au plus petit côté.
      const radius = (Math.min(w, h) / 2.5) * p.scale
      root.position.set(w / 2 + p.x, -(h / 2 + p.y), -radius)
      root.scale.setScalar(radius)
      stage.show(layer, p.opacity > 0.01)
      stage.invalidate()
      return
    }
    setTransform(this.svg, p.x, p.y, p.scale)
    setAlpha(this.svg, p.opacity)
  }
}

export type Rigs = { phone: PhoneRig; city: CityRig; earth: EarthRig }

export function createRigs(motion: Motion): Rigs {
  return { phone: new PhoneRig(motion), city: new CityRig(), earth: new EarthRig() }
}

/** Charge la 3D des scènes 3 à 7 (téléphone, globe) en arrière-plan, en mode complet seulement. */
export function load3D(motion: Motion, rigs: Rigs) {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-webgl]')
  if (motion.mode !== 'full' || !canvas) return
  void import('../webgl/extras')
    .then(async ({ loadPhone, loadGlobe }) => {
      const textureCanvas = createScreenCanvas()
      const phone = await loadPhone(canvas, () => motion.degradeToLite('context-lost'), textureCanvas)
      if (motion.mode !== 'full') return
      rigs.phone.attach3D({ ...phone, textureCanvas })
      const globe = await loadGlobe(canvas, () => motion.degradeToLite('context-lost'))
      if (motion.mode === 'full') rigs.earth.attach3D(globe)
      motion.onLite(() => rigs.earth.detach3D())
    })
    .catch(() => motion.degradeToLite('webgl'))
}
