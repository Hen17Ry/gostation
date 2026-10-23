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

/**
 * Découpe au-dessus de uFillY (hauteur dans le repère de la bouteille), liseré à la coupe et
 * lumière de contour (Fresnel) sur la peinture : la silhouette se détache du fond.
 */
function withFill<M extends Material>(material: M, yOffset: number, uniforms: FillUniforms, rim?: Color): M {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFillY = uniforms.uFillY
    shader.uniforms.uEdge = uniforms.uEdge
    shader.uniforms.uYOffset = { value: yOffset }
    shader.uniforms.uRim = { value: rim ?? new Color(0, 0, 0) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uYOffset;\nvarying float vBottleY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBottleY = position.y + uYOffset;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uFillY;\nuniform vec3 uEdge;\nuniform vec3 uRim;\nvarying float vBottleY;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'if (vBottleY > uFillY) discard;',
          'totalEmissiveRadiance += uEdge * smoothstep(uFillY - 0.07, uFillY, vBottleY) * 1.8;',
          'vec3 gsView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);',
          'totalEmissiveRadiance += uRim * pow(1.0 - saturate(dot(normal, gsView)), 3.0);',
        ].join('\n'),
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

/** Étiquette « GAZ · 10 KG » : fond clair, texte de la police d'affichage, lisible de loin. */
function plateTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 400
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = palette.neutral[50]
  ctx.beginPath()
  ctx.roundRect(10, 10, 620, 380, 44)
  ctx.fill()
  ctx.strokeStyle = palette.brand[600]
  ctx.lineWidth = 12
  ctx.stroke()
  ctx.fillStyle = palette.brand[950]
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '800 76px "Bricolage Grotesque", sans-serif'
  ctx.fillText('GAZ', 320, 132)
  ctx.font = '800 190px "Bricolage Grotesque", sans-serif'
  ctx.fillText('10 KG', 320, 330)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/** Hauteur → coordonnée v de la LatheGeometry (v suit l'indice des points du profil). */
function vAt(profile: readonly (readonly [number, number])[], y: number): number {
  for (let i = 1; i < profile.length; i++) {
    const y0 = profile[i - 1]![1]
    const y1 = profile[i]![1]
    if (y >= y0 && y <= y1) return (i - 1 + (y1 === y0 ? 0 : (y - y0) / (y1 - y0))) / (profile.length - 1)
  }
  return y < profile[0]![1] ? 0 : 1
}

/**
 * Peinture usée, procédurale : rugosité variable (canal vert), éclats de métal nu (canal bleu =
 * métal, teinte grise dans la carte de couleur) le long de l'épaule, de la soudure et du pied,
 * traînées discrètes sous le dôme. Une seule passe de dessin au chargement.
 */
function wearTextures(profile: readonly (readonly [number, number])[]) {
  const W = 1024
  const H = 512
  const make = () => {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    return [canvas, canvas.getContext('2d')!] as const
  }
  const [colorCanvas, color] = make()
  const [ormCanvas, orm] = make()
  // Pseudo-aléa reproductible : la même bouteille à chaque visite.
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const row = (y: number) => (1 - vAt(profile, y)) * H

  color.fillStyle = palette.neutral[50]
  color.fillRect(0, 0, W, H)
  // Rugosité de base 0,3 et grain fin (± 0,06), métal nul.
  const img = orm.createImageData(W, H)
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4 + 1] = 77 + Math.round((rand() - 0.5) * 30)
    img.data[i * 4 + 3] = 255
  }
  orm.putImageData(img, 0, 0)

  // Traînées sous le dôme : un peu plus sombres et plus mates.
  for (let i = 0; i < 10; i++) {
    const x = rand() * W
    const top = row(2.45 - rand() * 0.15)
    const len = (0.05 + rand() * 0.1) * H
    const grad = color.createLinearGradient(0, top, 0, top + len)
    grad.addColorStop(0, `${palette.neutral[600]}10`)
    grad.addColorStop(1, `${palette.neutral[600]}00`)
    color.fillStyle = grad
    color.fillRect(x, top, 1.5 + rand() * 2, len)
    // Canaux de données, pas des couleurs : vert = rugosité, bleu = métal.
    orm.fillStyle = 'rgba(0,120,0,0.1)'
    orm.fillRect(x, top, 1.5 + rand() * 2, len * 0.7)
  }

  // Éclats : métal nu, gris, plus rugueux.
  const chips = (y: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const x = rand() * W
      const cy = row(y + (rand() - 0.5) * spread)
      const r = 0.8 + rand() * 1.8
      color.fillStyle = palette.neutral[400]
      orm.fillStyle = 'rgb(0,150,230)'
      for (const ctx of [color, orm]) {
        ctx.beginPath()
        ctx.ellipse(x, cy, r * (1 + rand()), r, rand() * Math.PI, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  chips(2.36, 26, 0.1)
  chips(1.5, 14, 0.05)
  chips(0.6, 18, 0.15)

  const map = new CanvasTexture(colorCanvas)
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 4
  const ormMap = new CanvasTexture(ormCanvas)
  ormMap.anisotropy = 4
  return { map, orm: ormMap }
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
  await document.fonts?.load('800 190px "Bricolage Grotesque"').catch(() => undefined)

  const uniforms: FillUniforms = {
    uFillY: { value: -0.5 },
    uEdge: { value: new Color(palette.brand[300]) },
  }
  const geometries: BufferGeometry[] = []
  const materials: Material[] = []
  const textures: CanvasTexture[] = []

  const wear = wearTextures(bodyProfile())
  textures.push(wear.map, wear.orm)
  const rim = new Color(palette.brand[200]).multiplyScalar(0.32)
  const paint = (hex: string, opts: Partial<ConstructorParameters<typeof MeshPhysicalMaterial>[0]> = {}) =>
    new MeshPhysicalMaterial({
      color: new Color(hex),
      roughness: 1,
      metalness: 1,
      roughnessMap: wear.orm,
      metalnessMap: wear.orm,
      map: wear.map,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18,
      ...opts,
    })
  const steel = () => new MeshStandardMaterial({ color: new Color(palette.neutral[300]), metalness: 1, roughness: 0.3 })

  const root = new Group()
  root.rotation.x = TILT
  const spin = new Group()
  root.add(spin)

  const add = (geometry: BufferGeometry, material: Material, y = 0, setup?: (m: Mesh) => void, rimLight = false) => {
    geometries.push(geometry)
    materials.push(withFill(material, y, uniforms, rimLight ? rim : undefined))
    const mesh = new Mesh(geometry, material)
    mesh.position.y = y
    setup?.(mesh)
    spin.add(mesh)
    return mesh
  }

  // Corps et pied (révolution).
  add(lathe(bodyProfile(), 128), paint(palette.brand[500]), 0, undefined, true)
  add(
    lathe(footProfile(), 64),
    paint(palette.brand[600], {
      map: null,
      metalnessMap: null,
      metalness: 0.1,
      roughnessMap: null,
      roughness: 0.48,
      clearcoat: 0.4,
    }),
    0,
    undefined,
    true,
  )

  // Collerette ajourée (devant et derrière) et son bord roulé.
  const alpha = collarAlpha()
  textures.push(alpha)
  const collarHeight = COLLAR.top - COLLAR.bottom
  add(
    new CylinderGeometry(COLLAR.radius, COLLAR.radius, collarHeight, 72, 1, true, -Math.PI, Math.PI * 2),
    paint(palette.brand[600], {
      map: null,
      metalnessMap: null,
      metalness: 0.1,
      roughnessMap: null,
      roughness: 0.45,
      clearcoat: 0.5,
      side: DoubleSide,
      alphaMap: alpha,
      alphaTest: 0.5,
    }),
    COLLAR.bottom + collarHeight / 2,
    undefined,
    true,
  )
  // Doublure sombre : par les ajours, on voit l'intérieur de la collerette, jamais le fond de page.
  add(
    new CylinderGeometry(COLLAR.radius - 0.02, COLLAR.radius - 0.02, collarHeight, 48, 1, true),
    new MeshStandardMaterial({ color: new Color(palette.brand[950]), roughness: 0.85, side: BackSide }),
    COLLAR.bottom + collarHeight / 2,
  )
  add(
    new TorusGeometry(COLLAR.radius, COLLAR.rim, 10, 72),
    paint(palette.brand[600], { map: null, metalnessMap: null, metalness: 0.1, roughnessMap: null, roughness: 0.4 }),
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
    new CylinderGeometry(1.008, 1.008, PLATE.height, 32, 1, true, -PLATE.angle / 2, PLATE.angle),
    new MeshStandardMaterial({ map: plate, transparent: true, roughness: 0.55, depthWrite: false }),
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
