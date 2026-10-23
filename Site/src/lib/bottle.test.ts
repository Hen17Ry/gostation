import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { bodyProfile, FRAME, GROUND_Y, HEIGHT, radiusAt, silhouette, TILT, viewBox } from './bottle'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('bouteille', () => {
  it('le cadre du croquis a les proportions reprises dans le CSS', () => {
    const width = FRAME.right - FRAME.left
    const height = FRAME.top - FRAME.bottom
    // Bottle.astro : aspect-ratio 19 / 20 et origine des transformations au sol (90 %).
    expect(width / height).toBeCloseTo(19 / 20, 6)
    expect(FRAME.top / height).toBeCloseTo(0.9, 6)
    const bottleCss = read('../components/Bottle.astro')
    expect(bottleCss).toContain('aspect-ratio: 19 / 20')
    expect(bottleCss).toContain('transform-origin: 50% 90%')
    // Opening.astro : le pied se pose sur le bandeau (sol à 4,68 % au-dessus du bas du cadre).
    expect((GROUND_Y - FRAME.bottom) / height).toBeCloseTo(0.0468, 3)
    expect(read('../components/scenes/Opening.astro')).toContain('var(--stage-h) * 0.0468')
    expect(viewBox).toBe('-190 0 380 400')
  })

  it('tient dans le cadre, collerette comprise', () => {
    expect(HEIGHT * Math.cos(TILT) + 0.62 * Math.sin(TILT)).toBeLessThan(FRAME.top)
    expect(GROUND_Y).toBeGreaterThan(FRAME.bottom)
  })

  it('profil du corps : de l’axe à l’axe, plein rayon sur la virole', () => {
    const p = bodyProfile()
    expect(p[0]![0]).toBe(0)
    expect(p.at(-1)![0]).toBe(0)
    expect(radiusAt(p, 1)).toBeCloseTo(1, 6)
    expect(radiusAt(p, 2)).toBeCloseTo(1, 6)
  })

  it('silhouette symétrique, au plus large sur les flancs', () => {
    const s = silhouette(bodyProfile())
    const xs = s.map(([x]) => x)
    expect(Math.max(...xs)).toBeCloseTo(1.014, 3)
    expect(Math.min(...xs)).toBeCloseTo(-1.014, 3)
  })
})
