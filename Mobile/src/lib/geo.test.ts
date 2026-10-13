import { cumulativeLengths, decodePolyline, distanceM, routeProgress } from './geo'

/** Encodeur de référence (algorithme polyline) pour les allers-retours. */
function encode(points: { lat: number; lng: number }[], precision = 6): string {
  const f = 10 ** precision
  let out = ''
  let pLat = 0
  let pLng = 0
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1
    let s = ''
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63)
      n >>= 5
    }
    return s + String.fromCharCode(n + 63)
  }
  for (const p of points) {
    const lat = Math.round(p.lat * f)
    const lng = Math.round(p.lng * f)
    out += enc(lat - pLat) + enc(lng - pLng)
    pLat = lat
    pLng = lng
  }
  return out
}

describe('decodePolyline', () => {
  it('décode l’exemple de référence (précision 5)', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)
    expect(pts).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ])
  })

  it('fait l’aller-retour en polyline6 (OSRM)', () => {
    const line = [
      { lat: 6.365412, lng: 2.418301 },
      { lat: 6.366001, lng: 2.420117 },
      { lat: 6.3601, lng: 2.4301 },
    ]
    expect(decodePolyline(encode(line))).toEqual(line)
  })
})

describe('distanceM', () => {
  it('mesure environ 111 km par degré de latitude', () => {
    expect(distanceM({ lat: 6, lng: 2 }, { lat: 7, lng: 2 })).toBeGreaterThan(110_500)
    expect(distanceM({ lat: 6, lng: 2 }, { lat: 7, lng: 2 })).toBeLessThan(111_500)
  })
})

describe('routeProgress', () => {
  // Ligne droite vers l'est d'environ 1,1 km, à Cotonou.
  const line = [
    { lat: 6.37, lng: 2.4 },
    { lat: 6.37, lng: 2.405 },
    { lat: 6.37, lng: 2.41 },
  ]
  const cum = cumulativeLengths(line)

  it('projette la position sur le tracé et donne parcouru / restant', () => {
    const p = routeProgress({ lat: 6.3701, lng: 2.4075 }, line, cum)
    expect(p.segment).toBe(1)
    expect(p.offRouteM).toBeGreaterThan(8)
    expect(p.offRouteM).toBeLessThan(14)
    expect(p.traveledM + p.remainingM).toBeCloseTo(cum[2]!, 0)
    expect(p.traveledM / cum[2]!).toBeCloseTo(0.75, 2)
  })

  it('détecte un écart au-delà de 50 m', () => {
    const p = routeProgress({ lat: 6.3712, lng: 2.405 }, line, cum)
    expect(p.offRouteM).toBeGreaterThan(50)
  })
})
