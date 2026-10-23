/**
 * La scène WebGL unique du site (mode complet) : un canevas fixe plein écran, transparent, derrière
 * le texte, un seul contexte. Chaque objet (bouteille, téléphone, globe) vit dans son calque :
 *   - « ortho » : caméra orthographique, une unité = un pixel CSS (la bouteille, calée sur son croquis) ;
 *   - « perspective » : caméra en perspective réglée pour qu'en z = 0 une unité soit aussi un pixel
 *     CSS (le téléphone et le globe tournent avec une vraie profondeur, posés d'après le DOM).
 * Rendu à la demande : une image seulement quand une valeur a changé (invalidate) ou pendant une
 * animation continue (hold) ; rien quand aucun calque n'est visible, ni onglet caché.
 */
import {
  DirectionalLight,
  MathUtils,
  NeutralToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Camera,
  type Texture,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

import { gsap } from '../motion/engine'

export type FpsVerdict = 'ok' | 'slow'

export type Layer = { scene: Scene; camera: Camera; visible: boolean }

/** Champ de la caméra en perspective : assez étroit pour une profondeur douce. */
const FOV = 24

export class Stage {
  readonly renderer: WebGLRenderer
  readonly ortho = new OrthographicCamera(0, 1, 0, -1, 1, 4000)
  readonly perspective = new PerspectiveCamera(FOV, 1, 10, 20000)
  private readonly layers: Layer[] = []
  private readonly environment: Texture
  private dirty = true
  private holds = 0
  private width = 0
  private height = 0
  private shown = false
  private readonly tick = () => this.frame()
  private lost = false
  private probe: { frames: number[]; last: number; target: number; min: number; done: (v: FpsVerdict) => void } | null =
    null

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly onLost: () => void,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.autoClear = false
    this.renderer.outputColorSpace = SRGBColorSpace
    // Tonalité neutre : l'orange de la marque garde sa teinte (ACES la tire vers le rouge).
    this.renderer.toneMapping = NeutralToneMapping

    // Éclairage de studio procédural (aucun fichier HDR), partagé par tous les calques.
    const pmrem = new PMREMGenerator(this.renderer)
    const room = new RoomEnvironment()
    this.environment = pmrem.fromScene(room, 0.04).texture
    room.dispose()
    pmrem.dispose()

    this.ortho.position.set(0, 0, 2000)
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      this.lost = true
      this.onLost()
    })
    this.resize()
    window.addEventListener('resize', () => this.resize())
    gsap.ticker.add(this.tick)
  }

  /** Nouveau calque, éclairé : lumière principale en haut à gauche, contre-jour à droite. */
  addLayer(kind: 'ortho' | 'perspective', light = { key: 2.2, rim: 1.6, environment: 0.55 }): Layer {
    const scene = new Scene()
    scene.environment = this.environment
    scene.environmentIntensity = light.environment
    const key = new DirectionalLight(0xffffff, light.key)
    key.position.set(-700, 600, 900)
    const rim = new DirectionalLight(0xffffff, light.rim)
    rim.position.set(900, 250, -500)
    scene.add(key, rim)
    const layer: Layer = { scene, camera: kind === 'ortho' ? this.ortho : this.perspective, visible: false }
    this.layers.push(layer)
    return layer
  }

  /** Affiche ou masque un calque ; le canevas n'est visible que si un calque l'est. */
  show(layer: Layer, visible: boolean) {
    if (layer.visible === visible) return
    layer.visible = visible
    const any = this.layers.some((l) => l.visible)
    if (any !== this.shown) {
      this.shown = any
      this.canvas.style.visibility = any ? 'visible' : 'hidden'
    }
    this.invalidate()
  }

  get isLost() {
    return this.lost
  }

  get size() {
    return { width: this.width, height: this.height }
  }

  /** Pixel ratio plafonné : 2 sur ordinateur, 1,5 sur mobile. */
  private resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    const mobile = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2))
    this.renderer.setSize(w, h, false)
    // Repère commun : x vers la droite, y vers le haut ; le point (x, −y, 0) est le pixel CSS (x, y).
    Object.assign(this.ortho, { left: 0, right: w, top: 0, bottom: -h })
    this.ortho.updateProjectionMatrix()
    const distance = h / 2 / Math.tan(MathUtils.degToRad(FOV / 2))
    this.perspective.aspect = w / h
    this.perspective.position.set(w / 2, -h / 2, distance)
    this.perspective.lookAt(w / 2, -h / 2, 0)
    this.perspective.near = distance / 20
    this.perspective.far = distance * 20
    this.perspective.updateProjectionMatrix()
    this.invalidate()
  }

  invalidate = () => {
    this.dirty = true
  }

  /** Animation continue (rotation au repos) : une image à chaque tic tant qu'elle tient. */
  hold(): () => void {
    this.holds++
    let released = false
    return () => {
      if (released) return
      released = true
      this.holds--
    }
  }

  /** Compile les shaders sans bloquer (KHR_parallel_shader_compile) avant la première image. */
  async warmUp(layer: Layer) {
    await this.renderer.compileAsync(layer.scene, layer.camera)
  }

  /**
   * Mesure les images par seconde réellement affichées pendant `frames` images de rendu continu :
   * « slow » si la moyenne passe sous `min` (mode léger).
   */
  measureFps(frames = 45, min = 40): Promise<FpsVerdict> {
    return new Promise((resolve) => {
      const release = this.hold()
      this.probe = {
        frames: [],
        last: 0,
        target: frames,
        min,
        done: (verdict) => {
          release()
          resolve(verdict)
        },
      }
    })
  }

  private frame() {
    if (this.lost || !this.shown) return
    if (!this.dirty && this.holds === 0) return
    this.dirty = false
    this.renderer.clear()
    for (const layer of this.layers) {
      if (!layer.visible) continue
      this.renderer.clearDepth()
      this.renderer.render(layer.scene, layer.camera)
    }
    this.sample()
  }

  private sample() {
    const probe = this.probe
    if (!probe) return
    const now = performance.now()
    if (probe.last) probe.frames.push(now - probe.last)
    probe.last = now
    if (probe.frames.length < probe.target) return
    this.probe = null
    // Moyenne sans les 10 % les plus lents : un ramasse-miettes isolé ne condamne pas la 3D.
    const kept = [...probe.frames].sort((a, b) => a - b).slice(0, Math.ceil(probe.frames.length * 0.9))
    const fps = 1000 / (kept.reduce((sum, d) => sum + d, 0) / kept.length)
    document.documentElement.dataset.fps = String(Math.round(fps))
    probe.done(fps < probe.min ? 'slow' : 'ok')
  }
}

let stage: Stage | null = null

/** La scène unique (créée au premier besoin) ; lève une erreur si WebGL est indisponible. */
export function getStage(canvas: HTMLCanvasElement, onLost: () => void): Stage {
  stage ??= new Stage(canvas, onLost)
  canvas.hidden = false
  return stage
}
