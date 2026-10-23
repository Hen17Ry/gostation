/**
 * Bouteille de gaz 3D, faite dans le code (aucun fichier de modèle) à partir du profil partagé avec
 * le croquis (lib/bottle.ts) : corps et pied en LatheGeometry, collerette ajourée (alphaMap),
 * robinet, plaque « 10 KG ». Un uniform de remplissage découpe la bouteille au-dessus d'une hauteur,
 * avec un liseré lumineux : le croquis « se remplit » et devient objet.
 */
import {
  BackSide,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
  type Material,
} from 'three'

import { bodyProfile, COLLAR, COLLAR_WINDOW, footProfile, HEIGHT, PLATE, TILT, VALVE } from '../bottle'
import { palette } from '../tokens.generated'

type FillUniforms = { uFillY: { value: number }; uEdge: { value: Color } }

/** Découpe au-dessus de uFillY (hauteur dans le repère de la bouteille) et liseré à la coupe. */
function withFill<M extends Material>(material: M, yOffset: number, uniforms: FillUniforms): M {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFillY = uniforms.uFillY
    shader.uniforms.uEdge = uniforms.uEdge
    shader.uniforms.uYOffset = { value: yOffset }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uYOffset;\nvarying float vBottleY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBottleY = position.y + uYOffset;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uFillY;\nuniform vec3 uEdge;\nvarying float vBottleY;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\nif (vBottleY > uFillY) discard;\ntotalEmissiveRadiance += uEdge * smoothstep(uFillY - 0.07, uFillY, vBottleY) * 1.8;',
      )
  }
  material.customProgramCacheKey = () => 'gs-fill'
  return material
}

const lathe = (profile: readonly (readonly [number, number])[], segments: number) =>
  new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  )

/** Ajours de la collerette : blanc = matière, noir = vide (canal vert lu par alphaMap). */
function collarAlpha(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = palette.neutral[50]
  ctx.fillRect(0, 0, 512, 128)
  ctx.fillStyle = palette.neutral[950]
  const half = (COLLAR_WINDOW.halfAngle / (Math.PI * 2)) * 512
  // v = 1 en haut de la géométrie : la ligne 0 du canevas est le haut de la collerette.
  const top = (1 - COLLAR_WINDOW.to) * 128
  const height = (COLLAR_WINDOW.to - COLLAR_WINDOW.from) * 128
  for (const center of [256, 0, 512]) {
    ctx.beginPath()
    ctx.roundRect(center - half, top, half * 2, height, 14)
    ctx.fill()
  }
  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/** Plaque « GAZ · 10 KG » estampée, texte de la police d'affichage du site. */
function plateTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 320
  const ctx = canvas.getContext('2d')!
  ctx.strokeStyle = palette.brand[900]
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.roundRect(14, 14, 484, 292, 28)
  ctx.stroke()
  ctx.globalAlpha = 0.85
  ctx.fillStyle = palette.brand[900]
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '800 64px "Bricolage Grotesque", sans-serif'
  ctx.fillText('GAZ', 256, 104)
  ctx.font = '800 150px "Bricolage Grotesque", sans-serif'
  ctx.fillText('10 KG', 256, 262)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

export type BottleModel = {
  /** Groupe placé et mis à l'échelle par la scène (une unité = rayon du corps). */
  root: Group
  /** Rotation propre autour de l'axe de la bouteille. */
  spin: Group
  uniforms: FillUniforms
  dispose: () => void
}

export async function createBottle(): Promise<BottleModel> {
  // La plaque emploie la police d'affichage : on attend qu'elle soit chargée.
  await document.fonts?.load('800 150px "Bricolage Grotesque"').catch(() => undefined)

  const uniforms: FillUniforms = {
    uFillY: { value: -0.5 },
    uEdge: { value: new Color(palette.brand[300]) },
  }
  const geometries: BufferGeometry[] = []
  const materials: Material[] = []
  const textures: CanvasTexture[] = []

  const paint = (hex: string, opts: Partial<ConstructorParameters<typeof MeshPhysicalMaterial>[0]> = {}) =>
    new MeshPhysicalMaterial({
      color: new Color(hex),
      roughness: 0.32,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.14,
      ...opts,
    })
  const steel = () => new MeshStandardMaterial({ color: new Color(palette.neutral[300]), metalness: 1, roughness: 0.3 })

  const root = new Group()
  root.rotation.x = TILT
  const spin = new Group()
  root.add(spin)

  const add = (geometry: BufferGeometry, material: Material, y = 0, setup?: (m: Mesh) => void) => {
    geometries.push(geometry)
    materials.push(withFill(material, y, uniforms))
    const mesh = new Mesh(geometry, material)
    mesh.position.y = y
    setup?.(mesh)
    spin.add(mesh)
    return mesh
  }

  // Corps et pied (révolution).
  add(lathe(bodyProfile(), 96), paint(palette.brand[500]))
  add(lathe(footProfile(), 64), paint(palette.brand[600], { roughness: 0.42, clearcoat: 0.6 }))

  // Collerette ajourée (devant et derrière) et son bord roulé.
  const alpha = collarAlpha()
  textures.push(alpha)
  const collarHeight = COLLAR.top - COLLAR.bottom
  add(
    new CylinderGeometry(COLLAR.radius, COLLAR.radius, collarHeight, 72, 1, true, -Math.PI, Math.PI * 2),
    paint(palette.brand[600], { roughness: 0.42, clearcoat: 0.6, side: DoubleSide, alphaMap: alpha, alphaTest: 0.5 }),
    COLLAR.bottom + collarHeight / 2,
  )
  // Doublure sombre : par les ajours, on voit l'intérieur de la collerette, jamais le fond de page.
  add(
    new CylinderGeometry(COLLAR.radius - 0.02, COLLAR.radius - 0.02, collarHeight, 48, 1, true),
    new MeshStandardMaterial({ color: new Color(palette.brand[950]), roughness: 0.85, side: BackSide }),
    COLLAR.bottom + collarHeight / 2,
  )
  add(
    new TorusGeometry(COLLAR.radius, COLLAR.rim, 10, 72),
    paint(palette.brand[600], { roughness: 0.4 }),
    COLLAR.top,
    (m) => (m.rotation.x = Math.PI / 2),
  )

  // Robinet : tige, volant, sortie.
  add(new CylinderGeometry(VALVE.stemRadius, VALVE.stemRadius, 0.28, 24), steel(), 2.97)
  add(new CylinderGeometry(VALVE.wheelRadius, VALVE.wheelRadius, 0.06, 36), steel(), VALVE.wheelY)
  add(new CylinderGeometry(0.045, 0.045, 0.2, 16), steel(), 2.98, (m) => {
    m.rotation.z = Math.PI / 2
    m.position.x = 0.18
  })

  // Plaque « GAZ · 10 KG » sur le devant du corps.
  const plate = plateTexture()
  textures.push(plate)
  add(
    new CylinderGeometry(1.008, 1.008, PLATE.height, 24, 1, true, -PLATE.angle / 2, PLATE.angle),
    new MeshStandardMaterial({ map: plate, transparent: true, roughness: 0.5, depthWrite: false }),
    PLATE.y,
  )

  return {
    root,
    spin,
    uniforms,
    dispose() {
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      for (const t of textures) t.dispose()
    },
  }
}

/** Hauteur de remplissage complète (au-dessus du bord de la collerette). */
export const FULL_FILL = HEIGHT + 0.12
