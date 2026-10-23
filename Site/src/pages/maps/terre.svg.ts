import benin from '@/data/benin.json'
import { palette } from '@/lib/tokens.generated'

/**
 * La Terre vue de l'espace (scène 7, mode léger) : terres en points sur l'hémisphère visible, Bénin
 * en orange (Natural Earth, domaine public), halo d'atmosphère. Image statique, chargée à la demande.
 */
export const GET = () => {
  const R = benin.radius
  const [cx, cy] = benin.cotonou
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-R * 1.25} ${-R * 1.25} ${R * 2.5} ${R * 2.5}" width="1000" height="1000">
<defs><radialGradient id="a" r="0.5"><stop offset="0.78" stop-color="${palette.brand[400]}" stop-opacity="0"/><stop offset="0.8" stop-color="${palette.brand[300]}" stop-opacity="0.32"/><stop offset="1" stop-color="${palette.brand[400]}" stop-opacity="0"/></radialGradient>
<radialGradient id="s" cx="0.42" cy="0.38" r="0.62"><stop offset="0" stop-color="${palette.neutral[800]}"/><stop offset="1" stop-color="${palette.neutral[950]}"/></radialGradient></defs>
<circle r="${R * 1.25}" fill="url(#a)"/><circle r="${R}" fill="url(#s)"/>
<path d="${benin.land}" fill="${palette.neutral[500]}"/>
<path d="${benin.benin}" fill="${palette.brand[500]}" stroke="${palette.brand[200]}" stroke-width="2"/>
<circle cx="${cx}" cy="${cy}" r="7" fill="${palette.neutral[50]}"/></svg>`
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } })
}
