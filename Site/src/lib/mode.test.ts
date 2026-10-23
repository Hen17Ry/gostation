import { describe, expect, it } from 'vitest'

import { detectMode, modeScript } from './mode'

type Env = Parameters<typeof detectMode>[0]

const env = (
  over: { search?: string; reduce?: boolean; touch?: boolean; stored?: string | null } & Env['navigator'] = {},
): Env => ({
  location: { search: over.search ?? '' },
  matchMedia: (q) => ({
    matches: q.includes('reduced-motion') ? !!over.reduce : q.includes('pointer: coarse') ? !!over.touch : false,
  }),
  navigator: {
    deviceMemory: over.deviceMemory,
    hardwareConcurrency: over.hardwareConcurrency,
    connection: over.connection,
  },
  localStorage: { getItem: () => over.stored ?? null },
})

describe('detectMode', () => {
  it('complet par défaut', () => {
    expect(detectMode(env({ deviceMemory: 8, hardwareConcurrency: 8 }))).toBe('full')
    expect(detectMode(env())).toBe('full')
  })

  it('réduit dès que le système le demande', () => {
    expect(detectMode(env({ reduce: true, deviceMemory: 8 }))).toBe('reduced')
  })

  it('léger : mémoire, cœurs, économie de données, choix mémorisé', () => {
    expect(detectMode(env({ deviceMemory: 2 }))).toBe('lite')
    expect(detectMode(env({ deviceMemory: 4, hardwareConcurrency: 4, touch: true }))).toBe('lite')
    expect(detectMode(env({ hardwareConcurrency: 4 }))).toBe('full')
    expect(detectMode(env({ hardwareConcurrency: 2 }))).toBe('lite')
    expect(detectMode(env({ connection: { saveData: true } }))).toBe('lite')
    expect(detectMode(env({ stored: 'lite', deviceMemory: 8 }))).toBe('lite')
  })

  it('?mode= force le mode, même sous prefers-reduced-motion', () => {
    expect(detectMode(env({ search: '?mode=lite' }))).toBe('lite')
    expect(detectMode(env({ search: '?x=1&mode=full', reduce: true }))).toBe('full')
    expect(detectMode(env({ search: '?mode=turbo', reduce: true }))).toBe('reduced')
  })

  it('le script en ligne est autonome et pose html.js + data-motion', () => {
    const root = { classList: { add: (c: string) => classes.push(c) }, dataset: {} as Record<string, string> }
    const classes: string[] = []
    const window = { ...env({ deviceMemory: 2 }) }
    new Function('document', 'window', modeScript)({ documentElement: root }, window)
    expect(classes).toEqual(['js'])
    expect(root.dataset.motion).toBe('lite')
  })
})
