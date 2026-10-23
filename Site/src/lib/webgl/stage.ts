/**
 * La scène WebGL unique du site (mode complet) : un canevas fixe plein écran, transparent, derrière
 * le texte. Une unité du monde = un pixel CSS (caméra orthographique) : chaque scène place ses objets
 * d'après la position d'un élément du DOM. Rendu à la demande : une image seulement quand une valeur
 * a changé (invalidate) ou pendant une animation continue (hold) ; rien hors écran ni onglet caché.
 */
import {
  DirectionalLight,
  NeutralToneMapping,
  OrthographicCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

import { gsap } from '../motion/engine'

export type FpsVerdict = 'ok' | 'slow'

export class Stage {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new OrthographicCamera(0, 1, 0, -1, 1, 4000)
  private dirty = true
  private holds = 0
  private active = true
  private width = 0
  private height = 0
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
      // Pas de tampon de profondeur logarithmique ni de stencil : objets simples, canevas léger.
      stencil: false,
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = SRGBColorSpace
    // Tonalité neutre : l'orange de la marque garde sa teinte (ACES la tire vers le rouge).
    this.renderer.toneMapping = NeutralToneMapping
    this.renderer.toneMappingExposure = 1

    // Éclairage de studio procédural (aucun fichier HDR) : reflets du vernis de la bouteille.
    const pmrem = new PMREMGenerator(this.renderer)
    const room = new RoomEnvironment()
    this.scene.environment = pmrem.fromScene(room, 0.04).texture
    this.scene.environmentIntensity = 0.55
    room.dispose()
    pmrem.dispose()

    // Lumière principale en haut à gauche, contre-jour à droite : le cylindre garde son modelé.
    const key = new DirectionalLight(0xffffff, 2.2)
    key.position.set(-700, 600, 900)
    const rim = new DirectionalLight(0xffffff, 1.6)
    rim.position.set(900, 250, -500)
    this.scene.add(key, rim)

    this.camera.position.set(0, 0, 2000)

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      this.lost = true
      this.onLost()
    })

    this.resize()
    window.addEventListener('resize', () => this.resize())
    gsap.ticker.add(this.tick)
  }

  get isLost() {
    return this.lost
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
    // Repère : x vers la droite, y vers le haut ; le point (x, −y) est le pixel CSS (x, y).
    this.camera.left = 0
    this.camera.right = w
    this.camera.top = 0
    this.camera.bottom = -h
    this.camera.updateProjectionMatrix()
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

  /** Scène visible ou non : hors écran, le canevas est masqué et plus rien n'est rendu. */
  setActive(active: boolean) {
    if (this.active === active) return
    this.active = active
    this.canvas.style.visibility = active ? 'visible' : 'hidden'
    if (active) this.invalidate()
  }

  /** Compile les shaders sans bloquer (KHR_parallel_shader_compile) avant la première image. */
  async warmUp() {
    await this.renderer.compileAsync(this.scene, this.camera)
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
    if (this.lost || !this.active) return
    if (!this.dirty && this.holds === 0) return
    this.dirty = false
    this.renderer.render(this.scene, this.camera)
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

  dispose() {
    gsap.ticker.remove(this.tick)
    this.renderer.dispose()
  }
}
