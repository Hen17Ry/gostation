/** Géométrie légère (sans dépendance) : distances, tracé polyline6, progression sur un itinéraire. */
export interface LatLng {
  lat: number
  lng: number
}

const R = 6_371_008.8
const rad = (d: number) => (d * Math.PI) / 180

/** Distance à vol d'oiseau (haversine), en mètres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Décode un tracé encodé (algorithme polyline de Google, précision 6 pour OSRM `polyline6`). */
export function decodePolyline(encoded: string, precision = 6): LatLng[] {
  const factor = 10 ** precision
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const axis of [0, 1] as const) {
      let result = 0
      let shift = 0
      let byte: number
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += delta
      else lng += delta
    }
    points.push({ lat: lat / factor, lng: lng / factor })
  }
  return points
}

/** Projection d'un point sur un segment (repère local équirectangulaire, précis sur quelques km). */
function projectOnSegment(p: LatLng, a: LatLng, b: LatLng): { point: LatLng; t: number } {
  const k = Math.cos(rad(p.lat))
  const ax = a.lng * k
  const ay = a.lat
  const bx = b.lng * k
  const by = b.lat
  const px = p.lng * k
  const py = p.lat
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return { point: { lat: ay + t * dy, lng: (ax + t * dx) / k }, t }
}

export interface RouteProgress {
  /** Indice du segment le plus proche (entre les points i et i+1). */
  segment: number
  /** Point du tracé le plus proche de la position. */
  snapped: LatLng
  /** Écart entre la position et le tracé (m). */
  offRouteM: number
  /** Distance déjà parcourue le long du tracé (m). */
  traveledM: number
  /** Distance restante le long du tracé (m). */
  remainingM: number
}

/** Longueurs cumulées le long d'un tracé (m), pour la progression et le guidage. */
export function cumulativeLengths(line: LatLng[]): number[] {
  const out = [0]
  for (let i = 1; i < line.length; i++) out.push(out[i - 1]! + distanceM(line[i - 1]!, line[i]!))
  return out
}

/**
 * Position sur l'itinéraire : segment le plus proche (recherche autour du dernier segment connu
 * pour rester en O(1) en conduite), écart au tracé et distances parcourue / restante.
 */
export function routeProgress(position: LatLng, line: LatLng[], cumulative: number[], hint = 0): RouteProgress {
  const total = cumulative[cumulative.length - 1] ?? 0
  if (line.length < 2) {
    const only = line[0] ?? position
    return { segment: 0, snapped: only, offRouteM: distanceM(position, only), traveledM: 0, remainingM: total }
  }
  let best = { segment: 0, snapped: line[0]!, dist: Infinity, t: 0 }
  const from = Math.max(0, hint - 30)
  const to = Math.min(line.length - 1, hint + 60)
  const scan = (start: number, end: number) => {
    for (let i = start; i < end; i++) {
      const { point, t } = projectOnSegment(position, line[i]!, line[i + 1]!)
      const d = distanceM(position, point)
      if (d < best.dist) best = { segment: i, snapped: point, dist: d, t }
    }
  }
  scan(from, to)
  // Loin du voisinage connu (rare) : balayage complet.
  if (best.dist > 80) scan(0, line.length - 1)
  const segLen = (cumulative[best.segment + 1] ?? total) - (cumulative[best.segment] ?? 0)
  const traveled = (cumulative[best.segment] ?? 0) + segLen * best.t
  return {
    segment: best.segment,
    snapped: best.snapped,
    offRouteM: best.dist,
    traveledM: traveled,
    remainingM: Math.max(0, total - traveled),
  }
}

/** Emprise [ouest, sud, est, nord] d'une liste de points. */
export function bounds(points: LatLng[]): [number, number, number, number] {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const p of points) {
    w = Math.min(w, p.lng)
    e = Math.max(e, p.lng)
    s = Math.min(s, p.lat)
    n = Math.max(n, p.lat)
  }
  return [w, s, e, n]
}
