/**
 * Téléphone 3D fait dans le code (aucun fichier de modèle) : coque arrondie en verre et métal,
 * écran (texture peinte par lib/phone/painter.ts, sans tonalité ni éclairage : les couleurs de l'app
 * restent exactes), îlot, bloc photo et logo au dos (visible quand il pivote, scène 5).
 * Hauteur du modèle : 1,6 unité ; la scène le met à l'échelle de la boîte .phone du DOM.
 */
import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

import { palette } from '../tokens.generated'

export const PHONE_HEIGHT = 1.6
const W = PHONE_HEIGHT * (380 / 800)
const H = PHONE_HEIGHT
const D = 0.085

/** Rectangle arrondi centré, UV ramenés à [0, 1] (texture plein écran). */
function roundedRect(w: number, h: number, r: number): ShapeGeometry {
  const s = new Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  const g = new ShapeGeometry(s, 12)
  const pos = g.attributes.position!
  const uv = g.attributes.uv!
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - x) / w, (pos.getY(i) - y) / h)
  return g
}

/** Logo GoStation (épingle + éclair sur pastille) pour le dos. */
function logoTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.scale(8, 8)
  ctx.fillStyle = palette.brand[600]
  ctx.beginPath()
  ctx.roundRect(0, 0, 32, 32, 8)
  ctx.fill()
  ctx.fillStyle = palette.neutral[50]
  ctx.fill(
    new Path2D(
      'M16 6.5c-4 0-7.2 3.1-7.2 7 0 5.1 6.1 10.9 6.6 11.4a.9.9 0 0 0 1.2 0c.5-.5 6.6-6.3 6.6-11.4 0-3.9-3.2-7-7.2-7Z',
    ),
  )
  ctx.fillStyle = palette.brand[600]
  ctx.fill(new Path2D('M16.9 9.6l-3.2 4.6h2.4l-.9 3.9 3.3-4.9h-2.5l.9-3.6Z'))
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  return t
}

export type PhoneModel = {
  root: Group
  screen: CanvasTexture
  dispose: () => void
}

export function createPhone(screenCanvas: HTMLCanvasElement): PhoneModel {
  const geometries: BufferGeometry[] = []
  const materials: Material[] = []
  const root = new Group()
  const add = (g: BufferGeometry, m: Material, z = 0) => {
    geometries.push(g)
    materials.push(m)
    const mesh = new Mesh(g, m)
    mesh.position.z = z
    root.add(mesh)
    return mesh
  }

  // Coque : cadre métal satiné, faces en verre sombre.
  add(
    new RoundedBoxGeometry(W, H, D, 6, 0.1),
    new MeshPhysicalMaterial({
      color: new Color(palette.neutral[800]),
      metalness: 0.75,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    }),
  )

  const screen = new CanvasTexture(screenCanvas)
  screen.colorSpace = SRGBColorSpace
  screen.anisotropy = 8
  const bezel = 0.03
  add(
    roundedRect(W - bezel * 2, H - bezel * 2, 0.085),
    new MeshBasicMaterial({ map: screen, toneMapped: false }),
    D / 2 + 0.0015,
  )
  // Îlot de la caméra avant.
  add(
    roundedRect(W * 0.26, H * 0.032, 0.025),
    new MeshBasicMaterial({ color: new Color(palette.neutral[950]) }),
    D / 2 + 0.003,
  ).position.y = H / 2 - H * 0.052

  // Dos : verre teinté, bloc photo, logo.
  const back = add(
    roundedRect(W - 0.02, H - 0.02, 0.095),
    new MeshPhysicalMaterial({ color: new Color(palette.neutral[900]), metalness: 0.2, roughness: 0.18, clearcoat: 1 }),
    -D / 2 - 0.0015,
  )
  back.rotation.y = Math.PI
  const bump = add(
    new RoundedBoxGeometry(W * 0.34, W * 0.34, 0.02, 4, 0.04),
    new MeshPhysicalMaterial({ color: new Color(palette.neutral[800]), metalness: 0.6, roughness: 0.3, clearcoat: 1 }),
    -D / 2 - 0.01,
  )
  bump.position.set(W / 2 - W * 0.27, H / 2 - W * 0.27, -D / 2 - 0.01)
  const logo = logoTexture()
  const mark = add(
    new PlaneGeometry(0.2, 0.2),
    new MeshBasicMaterial({ map: logo, transparent: true, toneMapped: false }),
    -D / 2 - 0.004,
  )
  mark.rotation.y = Math.PI

  return {
    root,
    screen,
    dispose() {
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      screen.dispose()
      logo.dispose()
    },
  }
}
