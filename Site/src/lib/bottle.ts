/**
 * Géométrie de la bouteille de gaz, source unique du croquis SVG (rendu au build), de la bouteille
 * 2D (modes léger et réduit) et du modèle 3D (LatheGeometry). Unités : rayon du corps = 1, sol en
 * y = 0. La vue est orthographique, inclinée de TILT vers l'observateur : le croquis et la 3D se
 * superposent exactement, ce qui permet le passage de l'un à l'autre sans changer de cadrage.
 */

export type Point = readonly [r: number, y: number]

/** Inclinaison de la vue (rotation autour de X) : on voit un peu le dessus de la collerette. */
export const TILT = (14 * Math.PI) / 180

export const BODY_RADIUS = 1
/** Hauteur de la soudure (bourrelet circulaire à mi-corps). */
export const SEAM_Y = 1.5
/** Épaule : fin de la virole cylindrique, début du dôme. */
export const SHOULDER_Y = 2.36

export const FOOT = { radius: 0.88, inner: 0.84, height: 0.42 } as const
export const COLLAR = { radius: 0.62, bottom: 2.66, top: 3.34, rim: 0.03 } as const
/** Ajours de préhension de la collerette, devant et derrière (fraction de hauteur, demi-angle). */
export const COLLAR_WINDOW = { from: 0.5, to: 0.82, halfAngle: (34 * Math.PI) / 180 } as const
export const VALVE = { stemRadius: 0.1, stemTop: 3.1, wheelRadius: 0.17, wheelY: 3.14 } as const
/** Plaque « 10 kg » sur le devant du corps (angle total, centre, hauteur). */
export const PLATE = { angle: 0.84, y: 1.05, height: 0.56 } as const

/** Hauteur totale (sommet du bord roulé de la collerette). */
export const HEIGHT = COLLAR.top + COLLAR.rim

const quarter = (n: number) => Array.from({ length: n + 1 }, (_, i) => ((i / n) * Math.PI) / 2)

/** Profil extérieur du corps, de l'axe en bas à l'axe en haut (fond bombé, virole, dôme, bossage). */
export function bodyProfile(): Point[] {
  const pts: Point[] = quarter(14).map((t) => [Math.sin(t), 0.64 - 0.42 * Math.cos(t)] as const)
  pts.push([1, SEAM_Y - 0.03], [1.014, SEAM_Y - 0.01], [1.014, SEAM_Y + 0.01], [1, SEAM_Y + 0.03], [1, SHOULDER_Y])
  for (const t of quarter(14).slice(1)) {
    const r = Math.cos(t)
    if (r < 0.2) break
    pts.push([r, SHOULDER_Y + 0.42 * Math.sin(t)])
  }
  pts.push([0.2, 2.86], [0, 2.86])
  return pts
}

/** Pied (jupe) : coque fermée, bord supérieur arrondi. */
export function footProfile(): Point[] {
  const { radius: r, inner, height: h } = FOOT
  return [
    [inner, 0],
    [r, 0],
    [r, h - 0.02],
    [(r + inner) / 2, h + 0.01],
    [inner, h - 0.02],
    [inner, 0.001],
  ]
}

/** Rayon du corps à la hauteur y (0 hors du corps). */
export function radiusAt(profile: readonly Point[], y: number): number {
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1]!
    const [r1, y1] = profile[i]!
    if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1) && y1 !== y0) return r0 + ((y - y0) / (y1 - y0)) * (r1 - r0)
  }
  return 0
}

// ── Projection (vue de face, inclinée) ─────────────────────────────────────────────────────────

/** Point (x, y, z) du repère de la bouteille → plan de l'écran (X, Y), Y vers le haut. */
export function project(x: number, y: number, z: number): [number, number] {
  return [x, y * Math.cos(TILT) - z * Math.sin(TILT)]
}

/**
 * Silhouette exacte d'un solide de révolution vu incliné : chaque cercle de rayon r à la hauteur y
 * se projette en ellipse (r, r·sin TILT) centrée en y·cos TILT. Le contour est l'enveloppe haute
 * (max) et basse (min) de ces ellipses, échantillonnée en x.
 */
export function silhouette(profile: readonly Point[], samples = 72): [number, number][] {
  const rMax = Math.max(...profile.map(([r]) => r))
  const s = Math.sin(TILT)
  const c = Math.cos(TILT)
  const dense: Point[] = []
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1]!
    const [r1, y1] = profile[i]!
    for (let k = 0; k < 8; k++) dense.push([r0 + ((r1 - r0) * k) / 8, y0 + ((y1 - y0) * k) / 8])
  }
  dense.push(profile[profile.length - 1]!)
  const upper: [number, number][] = []
  const lower: [number, number][] = []
  for (let i = 0; i <= samples; i++) {
    // Échantillons resserrés près des bords (cosinus) : les flancs restent nets.
    const x = -rMax * Math.cos((i / samples) * Math.PI)
    let hi = -Infinity
    let lo = Infinity
    for (const [r, y] of dense) {
      if (Math.abs(x) > r) continue
      const h = s * Math.sqrt(r * r - x * x)
      hi = Math.max(hi, y * c + h)
      lo = Math.min(lo, y * c - h)
    }
    if (hi > -Infinity) {
      upper.push([x, hi])
      lower.push([x, lo])
    }
  }
  return [...lower, ...upper.reverse()]
}

/** Demi-ellipse avant (visible) du cercle de rayon r à la hauteur y. */
export function frontArc(r: number, y: number, segments = 40): [number, number][] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = Math.PI - (i / segments) * Math.PI // de gauche (π) à droite (0) en passant devant
    return project(r * Math.cos(t), y, r * Math.sin(t))
  })
}

/** Ellipse complète du cercle de rayon r à la hauteur y. */
export function fullEllipse(r: number, y: number, segments = 64): [number, number][] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = (i / segments) * Math.PI * 2
    return project(r * Math.cos(t), y, r * Math.sin(t))
  })
}

/** Ajour avant de la collerette (contour sur le cylindre, projeté). */
export function collarWindow(segments = 16): [number, number][] {
  const { radius: r, bottom, top } = COLLAR
  const y0 = bottom + (top - bottom) * COLLAR_WINDOW.from
  const y1 = bottom + (top - bottom) * COLLAR_WINDOW.to
  const a = COLLAR_WINDOW.halfAngle
  const along = (y: number, from: number, to: number) =>
    Array.from({ length: segments + 1 }, (_, i) => {
      const t = Math.PI / 2 + from + ((to - from) * i) / segments
      return project(r * Math.cos(t), y, r * Math.sin(t))
    })
  return [
    ...along(y0, a, -a),
    ...along(y1, -a, a),
    project(r * Math.cos(Math.PI / 2 + a), y0, r * Math.sin(Math.PI / 2 + a)),
  ]
}

/** Plaque avant (rectangle courbe) : contour projeté. */
export function plateOutline(segments = 16): [number, number][] {
  const r = BODY_RADIUS + 0.01
  const half = PLATE.angle / 2
  const y0 = PLATE.y - PLATE.height / 2
  const y1 = PLATE.y + PLATE.height / 2
  const along = (y: number, from: number, to: number) =>
    Array.from({ length: segments + 1 }, (_, i) => {
      const t = Math.PI / 2 + from + ((to - from) * i) / segments
      return project(r * Math.cos(t), y, r * Math.sin(t))
    })
  const first = along(y0, half, -half)
  return [...first, ...along(y1, -half, half), first[0]!]
}

// ── SVG ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Cadre du croquis, en unités de la bouteille (Y écran vers le haut) : 3,8 × 4, rapport 19/20, sol
 * à 90 % de la hauteur. Ces proportions sont reprises dans le CSS (Bottle.astro, Opening.astro) ;
 * bottle.test.ts vérifie qu'elles concordent.
 */
export const FRAME = { left: -1.9, right: 1.9, bottom: -0.4, top: 3.6 } as const

/** Le SVG compte en centièmes d'unité : des tailles de police et de trait lisibles (pas de 0,13 px). */
export const SVG_SCALE = 100

/** Repère SVG (y vers le bas) : x × 100, y = (haut du cadre − Y) × 100. */
export function toSvg([x, y]: readonly [number, number]): [number, number] {
  return [x * SVG_SCALE, (FRAME.top - y) * SVG_SCALE]
}

export const viewBox = `${FRAME.left * SVG_SCALE} 0 ${(FRAME.right - FRAME.left) * SVG_SCALE} ${(FRAME.top - FRAME.bottom) * SVG_SCALE}`

/** Point le plus bas du pied, devant (Y écran) : il se pose sur le haut du bandeau. */
export const GROUND_Y = -FOOT.radius * Math.sin(TILT)

const f = (n: number) => (Math.abs(n) < 1e-4 ? '0' : n.toFixed(2).replace(/\.?0+$/, ''))

export function pathOf(points: readonly (readonly [number, number])[], close = false): string {
  const d = points.map((p, i) => {
    const [x, y] = toSvg(p)
    return `${i ? 'L' : 'M'}${f(x)} ${f(y)}`
  })
  return d.join('') + (close ? 'Z' : '')
}

export function line(a: readonly [number, number], b: readonly [number, number]): string {
  return pathOf([a, b])
}

/** Les traits du croquis, dans l'ordre du tracé. */
export function sketchStrokes() {
  const body = bodyProfile()
  const foot = footProfile()
  const collarProfile: Point[] = [
    [0, COLLAR.bottom],
    [COLLAR.radius, COLLAR.bottom],
    [COLLAR.radius, COLLAR.top],
    [0, COLLAR.top],
  ]
  const ground = GROUND_Y
  return {
    construction: [
      line([FRAME.left + 0.05, ground], [FRAME.right - 0.05, ground]),
      line([0, FRAME.bottom + 0.12], [0, FRAME.top - 0.05]),
      line([-1.45, SEAM_Y * Math.cos(TILT)], [-1.12, SEAM_Y * Math.cos(TILT)]),
      line([-1.45, SHOULDER_Y * Math.cos(TILT)], [-1.12, SHOULDER_Y * Math.cos(TILT)]),
    ],
    outline: [pathOf(silhouette(foot), true), pathOf(silhouette(body), true), pathOf(silhouette(collarProfile), true)],
    detail: [
      pathOf(frontArc(1.014, SEAM_Y)),
      pathOf(frontArc(1, SHOULDER_Y)),
      pathOf(frontArc(FOOT.radius, FOOT.height)),
      pathOf(fullEllipse(COLLAR.radius, COLLAR.top)),
      pathOf(collarWindow(), true),
      pathOf(fullEllipse(VALVE.wheelRadius, VALVE.wheelY)),
      pathOf(plateOutline(), true),
    ],
    /** Repères des annotations (unités écran) : plaque et robinet. */
    callouts: {
      plate: project(0.36, PLATE.y + 0.1, Math.sqrt(1 - 0.36 ** 2)),
      valve: project(0.17, VALVE.wheelY, 0),
    },
  }
}

/** Contours pleins de la bouteille 2D (même projection que le croquis). */
export function solidShapes() {
  const collarProfile: Point[] = [
    [0, COLLAR.bottom],
    [COLLAR.radius, COLLAR.bottom],
    [COLLAR.radius, COLLAR.top + COLLAR.rim],
    [0, COLLAR.top + COLLAR.rim],
  ]
  const valveProfile: Point[] = [
    [0, 2.84],
    [VALVE.stemRadius, 2.84],
    [VALVE.stemRadius, VALVE.wheelY - 0.03],
    [VALVE.wheelRadius, VALVE.wheelY - 0.03],
    [VALVE.wheelRadius, VALVE.wheelY + 0.03],
    [0, VALVE.wheelY + 0.03],
  ]
  return {
    foot: pathOf(silhouette(footProfile()), true),
    body: pathOf(silhouette(bodyProfile()), true),
    collar: pathOf(silhouette(collarProfile), true),
    collarOpening: pathOf(fullEllipse(COLLAR.radius - 0.03, COLLAR.top + COLLAR.rim), true),
    valve: pathOf(silhouette(valveProfile), true),
    window: pathOf(collarWindow(), true),
    seam: pathOf(frontArc(1.014, SEAM_Y)),
    shoulder: pathOf(frontArc(1, SHOULDER_Y)),
    plate: pathOf(plateOutline(), true),
    plateCenter: project(0, PLATE.y, BODY_RADIUS),
  }
}
