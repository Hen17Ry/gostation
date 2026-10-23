/**
 * Écran du téléphone, dessiné en Canvas 2D d'après les vrais écrans de l'app (Mobile/docs/screenshots) :
 * recherche, ondes de recherche, résultats, guidage, stocks du gérant, rappel. Le même dessin sert
 * la 3D (texture de l'écran) et le mode léger (téléphone en HTML) ; il n'est refait qu'à un
 * changement d'état. Décor : le texte de l'histoire est dans la page (aria-hidden ici).
 */
import { city, results, target } from '@/lib/city'

import { palette, roles } from '../tokens.generated'

export const SCREEN = { width: 360, height: 780, scale: 2 } as const

export type Screen =
  | { kind: 'search'; product: 'gaz' | null; size: number | null; pressed?: boolean; tap?: Tap }
  | { kind: 'searching'; radius: string }
  | { kind: 'results' }
  | { kind: 'navigation'; step: number; progress: number }
  | { kind: 'arrived' }
  | { kind: 'stocks'; count: number; tap?: Tap; confirmed: boolean; reminder: number }
  | { kind: 'logo' }

export type Tap = { x: number; y: number; t: number }

const c = roles.light
const n = palette.neutral
const b = palette.brand
const FONT = '"Geist", system-ui, sans-serif'
const DISPLAY = '"Bricolage Grotesque", "Geist", sans-serif'

// Icônes Lucide (ISC) en Path2D, viewBox 24.
const ICONS = {
  flame:
    'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  fuel: 'M3 22h12M4 9h10M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5',
  droplet: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
  search: 'M21 21l-4.34-4.34M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  map: 'M14.1 4.4 9.9 2.3a2 2 0 0 0-1.8 0L3.6 4.6A1 1 0 0 0 3 5.5v14.9a1 1 0 0 0 1.4.9l4.7-2.4a2 2 0 0 1 1.8 0l4.2 2.1a2 2 0 0 0 1.8 0l4.5-2.3a1 1 0 0 0 .6-.9V3.6a1 1 0 0 0-1.4-.9l-4.7 2.4a2 2 0 0 1-1.8 0ZM15 5.8v15M9 3.2v15',
  heart:
    'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
  bell: 'M10.27 21a2 2 0 0 0 3.46 0M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  navigation: 'M3 11l19-9-9 19-2-8-8-2z',
  turnRight: 'M9 20V10a4 4 0 0 1 4-4h7M16 2l4 4-4 4',
  turnLeft: 'M15 20V10a4 4 0 0 0-4-4H4M8 2 4 6l4 4',
  roundabout: 'M12 22v-6M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 6l2-4M14.5 3h4l-.5 4',
  check: 'M20 6 9 17l-5-5',
  ban: 'M4.93 4.93l14.14 14.14M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  minus: 'M5 12h14',
  plus: 'M5 12h14M12 5v14',
  store:
    'M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5M17.77 10.88a2.4 2.4 0 0 1-3.77 0 2.4 2.4 0 0 1-3.77 0 2.4 2.4 0 0 1-3.77 0 2.7 2.7 0 0 1-4.46-2.92l2.79-4.36A2 2 0 0 1 5.7 3h12.6a2 2 0 0 1 1.66.89l2.79 4.36a2.7 2.7 0 0 1-4.46 2.92ZM4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05',
  flag: 'M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.33 2q2 0 3.87-.82a1 1 0 0 1 .8.82v10a1 1 0 0 1-.4.8 6 6 0 0 1-3.6 1.2c-3 0-5-2-7.33-2q-2 0-3.87.82',
  clock: 'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
} as const
const paths = new Map<string, Path2D>()
function icon(
  ctx: CanvasRenderingContext2D,
  name: keyof typeof ICONS,
  x: number,
  y: number,
  size: number,
  color: string,
  width = 2,
) {
  let p = paths.get(name)
  if (!p) paths.set(name, (p = new Path2D(ICONS[name])))
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(p)
  ctx.restore()
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 400,
  align: CanvasTextAlign = 'left',
  font = FONT,
) {
  ctx.font = `${weight} ${size}px ${font}`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(value, x, y)
}

// ── Carte (fond de l'app, palette claire) ───────────────────────────────────────────────────
let mapImage: HTMLImageElement | null = null
let mapReady: Promise<void> | null = null
export function loadMap(): Promise<void> {
  mapReady ??= new Promise((resolve) => {
    mapImage = new Image()
    mapImage.decoding = 'async'
    mapImage.onload = () => resolve()
    mapImage.onerror = () => resolve()
    mapImage.src = '/maps/cotonou-jour.svg'
  })
  return mapReady
}

const USER = city.user.at as [number, number]

/** Carte centrée sur `center` (unités de la ville), `zoom` pixels d'écran par unité. */
function drawMap(ctx: CanvasRenderingContext2D, h: number, center: readonly number[], zoom: number) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, SCREEN.width, h)
  ctx.clip()
  ctx.fillStyle = n[100]
  ctx.fillRect(0, 0, SCREEN.width, h)
  const tx = SCREEN.width / 2 - center[0]! * zoom
  const ty = h / 2 - center[1]! * zoom
  if (mapImage?.complete && mapImage.naturalWidth) {
    ctx.drawImage(mapImage, tx, ty, city.width * zoom, city.height * zoom)
  }
  ctx.restore()
  return (p: readonly number[]): [number, number] => [tx + p[0]! * zoom, ty + p[1]! * zoom]
}

function userDot(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = c.info
  ctx.globalAlpha = 0.18
  ctx.beginPath()
  ctx.arc(x, y, 14, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.arc(x, y, 6.5, 0, Math.PI * 2)
  ctx.fillStyle = palette.neutral[50]
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, 4.5, 0, Math.PI * 2)
  ctx.fillStyle = c.info
  ctx.fill()
}

function pin(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, active = true) {
  ctx.beginPath()
  ctx.arc(x, y, 11, 0, Math.PI * 2)
  ctx.fillStyle = active ? b[600] : n[400]
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = palette.neutral[50]
  ctx.stroke()
  text(ctx, label, x, y + 4.5, 12, palette.neutral[50], 700, 'center')
}

function statusBar(ctx: CanvasRenderingContext2D, dark = false) {
  const color = dark ? palette.neutral[50] : n[950]
  text(ctx, '19:42', 22, 26, 13, color, 600)
  ctx.fillStyle = color
  for (let i = 0; i < 4; i++) ctx.fillRect(SCREEN.width - 78 + i * 5, 22 - i * 2.5, 3, 4 + i * 2.5)
  rr(ctx, SCREEN.width - 50, 14, 24, 12, 3)
  ctx.lineWidth = 1.4
  ctx.strokeStyle = color
  ctx.stroke()
  ctx.fillRect(SCREEN.width - 48, 16, 16, 8)
}

function chip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, selected: boolean) {
  rr(ctx, x, y, w, 30, 15)
  ctx.fillStyle = selected ? b[600] : palette.neutral[50]
  ctx.fill()
  if (!selected) {
    ctx.lineWidth = 1
    ctx.strokeStyle = n[300]
    ctx.stroke()
  }
  text(ctx, label, x + w / 2, y + 19.5, 12.5, selected ? palette.neutral[50] : n[900], 600, 'center')
}

function button(
  ctx: CanvasRenderingContext2D,
  y: number,
  label: string,
  iconName: keyof typeof ICONS,
  pressed = false,
) {
  const x = 16
  const w = SCREEN.width - 32
  rr(ctx, x, y, w, 46, 12)
  ctx.fillStyle = pressed ? b[700] : b[600]
  ctx.fill()
  ctx.font = `600 15px ${FONT}`
  const tw = ctx.measureText(label).width
  icon(ctx, iconName, SCREEN.width / 2 - tw / 2 - 12, y + 15, 16, palette.neutral[50])
  text(ctx, label, SCREEN.width / 2 + 10, y + 28.5, 15, palette.neutral[50], 600, 'center')
}

function ripple(ctx: CanvasRenderingContext2D, tap?: Tap) {
  if (!tap || tap.t <= 0 || tap.t >= 1) return
  ctx.save()
  ctx.globalAlpha = 0.35 * (1 - tap.t)
  ctx.fillStyle = n[950]
  ctx.beginPath()
  ctx.arc(tap.x, tap.y, 8 + 34 * tap.t, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function tabBar(ctx: CanvasRenderingContext2D, items: [keyof typeof ICONS, string][], active: number) {
  const y = SCREEN.height - 64
  ctx.fillStyle = palette.neutral[50]
  ctx.fillRect(0, y, SCREEN.width, 64)
  ctx.fillStyle = n[200]
  ctx.fillRect(0, y, SCREEN.width, 1)
  const w = SCREEN.width / items.length
  items.forEach(([name, label], i) => {
    const color = i === active ? b[600] : n[500]
    icon(ctx, name, i * w + w / 2 - 10, y + 12, 20, color, 1.8)
    text(ctx, label, i * w + w / 2, y + 46, 10.5, color, i === active ? 600 : 500, 'center')
  })
}

const USER_TABS: [keyof typeof ICONS, string][] = [
  ['map', 'Carte'],
  ['heart', 'Favoris'],
  ['bell', 'Notifications'],
  ['user', 'Compte'],
]
const MANAGER_TABS: [keyof typeof ICONS, string][] = [
  ['store', 'Stocks'],
  ['fuel', 'Ma station'],
  ['flag', 'Signalements'],
  ['bell', 'Notifications'],
  ['user', 'Compte'],
]

function sheet(ctx: CanvasRenderingContext2D, y: number) {
  ctx.save()
  ctx.shadowColor = `${n[950]}1f`
  ctx.shadowBlur = 18
  rr(ctx, 0, y, SCREEN.width, SCREEN.height - y, 18)
  ctx.fillStyle = palette.neutral[50]
  ctx.fill()
  ctx.restore()
  rr(ctx, SCREEN.width / 2 - 18, y + 8, 36, 4, 2)
  ctx.fillStyle = n[300]
  ctx.fill()
}

// ── Écrans ───────────────────────────────────────────────────────────────────────────────────
function searchScreen(ctx: CanvasRenderingContext2D, s: Extract<Screen, { kind: 'search' }>) {
  const at = drawMap(ctx, 420, USER, 0.62)
  userDot(ctx, ...at(USER))
  statusBar(ctx)
  const top = 360
  sheet(ctx, top)
  text(ctx, 'Que cherchez-vous ?', 16, top + 44, 19, n[950], 700)
  const products: [string, keyof typeof ICONS][] = [
    ['Gaz', 'flame'],
    ['Essence', 'fuel'],
    ['Gasoil', 'droplet'],
  ]
  const w = (SCREEN.width - 32 - 16) / 3
  products.forEach(([label, iconName], i) => {
    const x = 16 + i * (w + 8)
    const selected = s.product === 'gaz' && i === 0
    rr(ctx, x, top + 62, w, 78, 12)
    ctx.fillStyle = selected ? b[50] : palette.neutral[50]
    ctx.fill()
    ctx.lineWidth = selected ? 2 : 1
    ctx.strokeStyle = selected ? b[600] : n[200]
    ctx.stroke()
    icon(ctx, iconName, x + w / 2 - 11, top + 78, 22, selected ? b[600] : n[700], 1.8)
    text(ctx, label, x + w / 2, top + 125, 12.5, selected ? b[700] : n[800], 600, 'center')
  })
  if (s.product) {
    text(ctx, 'Taille de la bouteille', 16, top + 168, 12.5, n[600], 500)
    ;[5, 10, 25].forEach((kg, i) => chip(ctx, 16 + i * 70, top + 180, 62, `${kg} kg`, s.size === kg))
  }
  button(ctx, top + 236, 'Rechercher', 'search', s.pressed)
  tabBar(ctx, USER_TABS, 0)
  ripple(ctx, s.tap)
}

function searchingScreen(ctx: CanvasRenderingContext2D, s: Extract<Screen, { kind: 'searching' }>) {
  const zoom = 0.38
  const at = drawMap(ctx, 520, USER, zoom)
  const [ux, uy] = at(USER)
  const meters = s.radius === '500 m' ? 500 : s.radius === '1 km' ? 1000 : 2000
  const r = (meters / city.metersPerUnit) * zoom
  ctx.beginPath()
  ctx.arc(ux, uy, r, 0, Math.PI * 2)
  ctx.fillStyle = b[500]
  ctx.globalAlpha = 0.12
  ctx.fill()
  ctx.globalAlpha = 0.9
  ctx.lineWidth = 2
  ctx.strokeStyle = b[600]
  ctx.stroke()
  ctx.globalAlpha = 1
  rr(ctx, ux - 30, uy - r - 14, 60, 22, 11)
  ctx.fillStyle = b[600]
  ctx.fill()
  text(ctx, s.radius, ux, uy - r + 1.5, 12, palette.neutral[50], 700, 'center')
  userDot(ctx, ux, uy)
  statusBar(ctx)
  sheet(ctx, 520)
  text(ctx, 'Gaz 10 kg', 16, 562, 17, n[950], 700)
  text(ctx, 'Stations ouvertes, avec du stock à jour', 16, 584, 12.5, n[600], 400)
  button(ctx, 610, 'Recherche des stations…', 'search', true)
  tabBar(ctx, USER_TABS, 0)
}

function resultsScreen(ctx: CanvasRenderingContext2D) {
  const zoom = 0.4
  const at = drawMap(ctx, 330, [USER[0] - 10, USER[1] - 30], zoom)
  results.forEach((st, i) => pin(ctx, ...at(st.at), String(i + 1)))
  userDot(ctx, ...at(USER))
  statusBar(ctx)
  sheet(ctx, 300)
  icon(ctx, 'flame', 16, 322, 20, b[600], 1.8)
  text(ctx, 'Gaz 10 kg', 44, 338, 16, n[950], 700)
  text(ctx, `${results.length} stations · la plus proche à ${km(results[0]!.distanceM)}`, 44, 356, 12, n[600])
  text(ctx, 'RÉSULTATS DE LA RECHERCHE', 16, 388, 10.5, n[500], 600)
  results.forEach((st, i) => {
    const y = 398 + i * 98
    rr(ctx, 12, y, SCREEN.width - 24, 90, 12)
    ctx.fillStyle = palette.neutral[50]
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = n[200]
    ctx.stroke()
    pin(ctx, 34, y + 22, String(i + 1))
    text(ctx, st.name ?? 'Station', 54, y + 27, 13.5, n[950], 700)
    text(ctx, `${km(st.routeDistanceM ?? st.distanceM)} · ${minutes(st.durationS ?? 0)}`, 54, y + 45, 11.5, n[600])
    rr(ctx, 54, y + 54, 92, 22, 11)
    ctx.fillStyle = c['success-subtle']
    ctx.fill()
    text(ctx, `${st.quantity} bouteilles`, 100, y + 69, 11, c['success-subtle-foreground'], 600, 'center')
    text(ctx, i === 0 ? 'Mis à jour il y a 12 min' : `Mis à jour il y a ${24 + i * 9} min`, 156, y + 69, 10.5, n[500])
  })
  tabBar(ctx, USER_TABS, 0)
}

/** Étapes du guidage, d'après le vrai trajet calculé par OSRM (scripts/gen-city.py). */
export const NAV_STEPS = city.route.steps
  .filter((s) => s.type !== 'depart' && s.type !== 'arrive')
  .map((s) => ({
    icon: (s.type === 'rotary' ? 'roundabout' : s.modifier === 'left' ? 'turnLeft' : 'turnRight') as keyof typeof ICONS,
    label:
      s.type === 'rotary' ? 'Au rond-point, sortez' : s.modifier === 'left' ? 'Tournez à gauche' : 'Tournez à droite',
    street: s.name,
    at: s.at as [number, number],
  }))

function navigationScreen(ctx: CanvasRenderingContext2D, s: Extract<Screen, { kind: 'navigation' }>) {
  const step = NAV_STEPS[Math.min(s.step, NAV_STEPS.length - 1)]!
  const zoom = 0.9
  const at = drawMap(ctx, SCREEN.height, step.at, zoom)
  // Tracé de l'itinéraire (le même que sur la grande carte).
  const route = new Path2D(city.route.d)
  ctx.save()
  const [ox, oy] = at([0, 0])
  ctx.translate(ox, oy)
  ctx.scale(zoom, zoom)
  ctx.lineWidth = 7 / zoom
  ctx.strokeStyle = b[600]
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(route)
  ctx.restore()
  const [tx, ty] = at(target.at)
  pin(ctx, tx, ty, '1')
  // Bandeau du haut : prochaine manœuvre.
  ctx.fillStyle = b[600]
  ctx.fillRect(0, 0, SCREEN.width, 36)
  statusBar(ctx, true)
  rr(ctx, 10, 42, SCREEN.width - 20, 84, 16)
  ctx.fillStyle = b[600]
  ctx.fill()
  icon(ctx, step.icon, 24, 60, 40, palette.neutral[50], 2.4)
  const meters = Math.max(20, Math.round((1 - s.progress) * 30) * 10)
  text(ctx, `${meters} m`, 78, 82, 24, palette.neutral[50], 700, 'left', DISPLAY)
  text(ctx, `${step.label} · ${step.street}`, 78, 106, 12.5, b[50], 500)
  // Carte du bas : heure d'arrivée.
  rr(ctx, 10, SCREEN.height - 96, SCREEN.width - 20, 80, 18)
  ctx.fillStyle = palette.neutral[50]
  ctx.fill()
  text(ctx, '19:44', SCREEN.width / 2, SCREEN.height - 58, 22, n[950], 700, 'center')
  text(
    ctx,
    `${minutes(city.route.durationS)} · ${km(city.route.distanceM)}`,
    SCREEN.width / 2,
    SCREEN.height - 36,
    12,
    n[600],
    500,
    'center',
  )
}

function arrivedScreen(ctx: CanvasRenderingContext2D) {
  const at = drawMap(ctx, SCREEN.height, target.at, 1.2)
  pin(ctx, ...at(target.at), '1')
  statusBar(ctx)
  rr(ctx, 10, 42, SCREEN.width - 20, 64, 16)
  ctx.fillStyle = c['success-subtle']
  ctx.fill()
  icon(ctx, 'check', 26, 62, 24, c['success-subtle-foreground'], 2.6)
  text(ctx, 'Vous êtes arrivé', 64, 80, 17, c['success-subtle-foreground'], 700)
  sheet(ctx, SCREEN.height - 230)
  const y = SCREEN.height - 200
  text(ctx, target.name ?? 'Station', 16, y + 6, 17, n[950], 700)
  text(ctx, 'Ouverte · Gaz 10 kg', 16, y + 28, 12.5, n[600])
  rr(ctx, 16, y + 44, 120, 28, 14)
  ctx.fillStyle = c['success-subtle']
  ctx.fill()
  text(ctx, `${target.quantity} bouteilles`, 76, y + 63, 12.5, c['success-subtle-foreground'], 700, 'center')
  icon(ctx, 'clock', 16, y + 92, 15, n[500], 1.8)
  text(ctx, 'Mis à jour il y a 12 min', 38, y + 104, 12.5, n[600])
}

function stocksScreen(ctx: CanvasRenderingContext2D, s: Extract<Screen, { kind: 'stocks' }>) {
  ctx.fillStyle = n[100]
  ctx.fillRect(0, 0, SCREEN.width, SCREEN.height)
  statusBar(ctx)
  if (s.confirmed) {
    rr(ctx, 12, 40, SCREEN.width - 24, 40, 12)
    ctx.fillStyle = c['success-subtle']
    ctx.fill()
    icon(ctx, 'check', 24, 50, 20, c['success-subtle-foreground'], 2.4)
    text(ctx, 'Stocks confirmés · à l’instant', 52, 65, 13.5, c['success-subtle-foreground'], 600)
  } else {
    text(ctx, 'Stocks', 16, 68, 22, n[950], 800, 'left', DISPLAY)
  }
  text(ctx, target.name ?? 'Station', 16, 104, 12.5, n[600])
  const card = (y: number, h: number, title: string, sub: string) => {
    rr(ctx, 12, y, SCREEN.width - 24, h, 14)
    ctx.fillStyle = palette.neutral[50]
    ctx.fill()
    text(ctx, title, 26, y + 26, 14.5, n[950], 700)
    text(ctx, sub, 26, y + 44, 11, n[500])
    rr(ctx, SCREEN.width - 112, y + 12, 86, 28, 14)
    ctx.lineWidth = 1
    ctx.strokeStyle = n[300]
    ctx.stroke()
    icon(ctx, 'ban', SCREEN.width - 104, y + 19, 14, b[600], 2)
    text(ctx, 'Rupture', SCREEN.width - 62, y + 31, 11.5, b[700], 600, 'center')
  }
  const counter = (y: number, value: string, unit = '') => {
    icon(ctx, 'minus', 30, y + 9, 22, n[800], 2.2)
    rr(ctx, 72, y, SCREEN.width - 144, 40, 10)
    ctx.fillStyle = n[100]
    ctx.fill()
    text(ctx, value + unit, SCREEN.width / 2, y + 27, 18, n[950], 700, 'center')
    icon(ctx, 'plus', SCREEN.width - 52, y + 9, 22, n[800], 2.2)
  }
  card(120, 116, 'Gaz 10 kg', s.confirmed ? 'Confirmé à l’instant' : 'Mis à jour il y a 4 h')
  counter(120 + 62, String(s.count))
  card(246, 116, 'Gaz 5 kg', s.confirmed ? 'Confirmé à l’instant' : 'Mis à jour il y a 4 h')
  counter(246 + 62, '8')
  card(372, 116, 'Essence', s.confirmed ? 'Confirmé à l’instant' : 'Mis à jour il y a 4 h')
  rr(ctx, 26, 372 + 62, SCREEN.width - 52, 40, 10)
  ctx.fillStyle = n[100]
  ctx.fill()
  text(ctx, '1 200', 40, 372 + 89, 18, n[950], 700)
  text(ctx, 'L', SCREEN.width - 40, 372 + 89, 14, n[500], 600, 'right')
  button(ctx, SCREEN.height - 128, 'Rien n’a changé', 'check', false)
  tabBar(ctx, MANAGER_TABS, 0)
  if (s.reminder > 0) reminder(ctx, s.reminder)
  ripple(ctx, s.tap)
}

/** Rappel des 4 h : la notification, avec ses deux vraies actions. */
function reminder(ctx: CanvasRenderingContext2D, t: number) {
  ctx.save()
  ctx.globalAlpha = 0.35 * t
  ctx.fillStyle = n[950]
  ctx.fillRect(0, 0, SCREEN.width, SCREEN.height)
  ctx.restore()
  const y = -150 + 192 * easeOut(t)
  ctx.save()
  ctx.shadowColor = `${n[950]}40`
  ctx.shadowBlur = 24
  rr(ctx, 10, y, SCREEN.width - 20, 150, 22)
  ctx.fillStyle = n[50]
  ctx.fill()
  ctx.restore()
  rr(ctx, 24, y + 16, 28, 28, 8)
  ctx.fillStyle = b[600]
  ctx.fill()
  text(ctx, 'GoStation · maintenant', 62, y + 35, 12, n[600], 500)
  text(ctx, 'Vos stocks sont-ils à jour ?', 24, y + 66, 15.5, n[950], 700)
  text(ctx, 'Dernière mise à jour il y a 4 h. Mettez à jour', 24, y + 87, 12.5, n[700])
  text(ctx, 'ou confirmez en un geste.', 24, y + 104, 12.5, n[700])
  text(ctx, 'Mettre à jour', 24, y + 134, 13.5, b[700], 700)
  text(ctx, 'Rien n’a changé', 150, y + 134, 13.5, b[700], 700)
}

function logoScreen(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = n[950]
  ctx.fillRect(0, 0, SCREEN.width, SCREEN.height)
}

const easeOut = (t: number) => 1 - (1 - t) ** 3
const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`)
const minutes = (s: number) => `${Math.max(1, Math.round(s / 60))} min`

/** Peint `screen` dans le canevas (720 × 1560 pour un écran logique de 360 × 780). */
export function paint(canvas: HTMLCanvasElement, screen: Screen) {
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(SCREEN.scale, 0, 0, SCREEN.scale, 0, 0)
  ctx.clearRect(0, 0, SCREEN.width, SCREEN.height)
  ctx.fillStyle = c.background
  ctx.fillRect(0, 0, SCREEN.width, SCREEN.height)
  switch (screen.kind) {
    case 'search':
      return searchScreen(ctx, screen)
    case 'searching':
      return searchingScreen(ctx, screen)
    case 'results':
      return resultsScreen(ctx)
    case 'navigation':
      return navigationScreen(ctx, screen)
    case 'arrived':
      return arrivedScreen(ctx)
    case 'stocks':
      return stocksScreen(ctx, screen)
    case 'logo':
      return logoScreen(ctx)
  }
}

export function createScreenCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = SCREEN.width * SCREEN.scale
  canvas.height = SCREEN.height * SCREEN.scale
  return canvas
}

/** Clé d'égalité : on ne repeint que si l'état a changé. */
export const screenKey = (s: Screen) => JSON.stringify(s)
