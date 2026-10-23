/**
 * Fonds de carte du site, rendus au build en SVG statiques (src/pages/maps/) depuis la géométrie
 * de src/data/ (scripts/gen-city.py, scripts/gen-geo.py). Servis comme images (<img>, décodées hors
 * du fil principal, en cache) ; tout ce qui s'anime (trajets, stations, ondes) est un calque SVG en
 * ligne par-dessus, dans le même repère. Données © les contributeurs d'OpenStreetMap (ODbL).
 */
import city from '@/data/city.json'
import region from '@/data/region.json'

import { mapPalette, type MapTheme } from './map-palette'
import { palette } from './tokens.generated'

type Roads = { major: string; medium: string; minor?: string }

function svg(width: number, height: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice">${body}</svg>`
}

function roadsLayer(theme: MapTheme, roads: Roads, scale = 1) {
  const p = mapPalette[theme]
  const line = (d: string, color: string, width: number, extra = '') =>
    d
      ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width * scale}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`
      : ''
  return [
    roads.minor ? line(roads.minor, p.minor, theme === 'light' ? 1.1 : 0.8) : '',
    line(roads.medium, p.majorCasing, 2.6),
    line(roads.major, p.majorCasing, 4.2),
    line(roads.medium, p.majorInner, 1.5),
    line(roads.major, p.majorInner, 2.6),
  ].join('')
}

/** Lampadaires : points ambrés le long des grands axes (la ville de nuit). */
function streetLights(d: string, scale = 1) {
  return `<path d="${d}" fill="none" stroke="${palette.brand[300]}" stroke-opacity="0.5" stroke-width="${2.8 * scale}" stroke-linecap="round" stroke-dasharray="0.1 ${16 * scale}"/>`
}

export function citySvg(theme: MapTheme): string {
  const p = mapPalette[theme]
  return svg(
    city.width,
    city.height,
    `<rect width="${city.width}" height="${city.height}" fill="${p.background}"/>` +
      `<path d="${city.water}" fill="${p.water}"/>` +
      roadsLayer(theme, city.roads) +
      (theme === 'dark' ? streetLights(city.roads.major) : ''),
  )
}

export function regionSvg(): string {
  const p = mapPalette.dark
  return svg(
    region.width,
    region.height,
    `<rect width="${region.width}" height="${region.height}" fill="${p.background}"/>` +
      `<path d="${region.water}" fill="${p.water}"/>` +
      roadsLayer('dark', { major: region.roads, medium: '' }, 0.9) +
      streetLights(region.roads, 1.2),
  )
}
