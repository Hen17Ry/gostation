/**
 * Données de la ville partagées par la carte, l'écran du téléphone et les scènes : la version légère
 * (stations, trajets), sans la géométrie du fond de carte qui ne sert qu'au build (lib/map-svg.ts).
 */
import city from '@/data/city-points.json'

export { city }

export type Station = (typeof city.stations)[number]

/** Les stations en stock à moins de 2 km, par temps de trajet : le classement de l'app. */
export const results: Station[] = city.stations
  .filter((s) => s.status === 'stock' && s.distanceM <= 2000)
  .sort((a, b) => (a.durationS ?? 0) - (b.durationS ?? 0))

export const target: Station = city.stations.find((s) => s.id === city.target)!

/** Mètres → unités de la carte. */
export const toUnits = (meters: number) => meters / city.metersPerUnit

/** Sommets d'un tracé SVG en polyligne (M x y L x y …), tel que l'écrit scripts/gen-city.py. */
export function polyline(d: string): [number, number][] {
  return [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
}

/**
 * Fraction de longueur du tracé où passe chaque point (le sommet le plus proche) : calcul direct
 * sur la polyligne, sans interroger le moteur SVG (aucun travail de mise en page au démarrage).
 */
export function fractionsOnPolyline(d: string, points: readonly (readonly number[])[]): number[] {
  const pts = polyline(d)
  const cumulative = [0]
  for (let i = 1; i < pts.length; i++) {
    cumulative.push(cumulative[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))
  }
  const total = cumulative.at(-1) || 1
  return points.map(([x, y]) => {
    let best = 0
    let dist = Infinity
    pts.forEach(([px, py], i) => {
      const dd = (px - x!) ** 2 + (py - y!) ** 2
      if (dd < dist) {
        dist = dd
        best = i
      }
    })
    return cumulative[best]! / total
  })
}

/** Centre de la boîte englobante d'un tracé. */
export function pathCenter(d: string): [number, number] {
  const pts = polyline(d)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}
