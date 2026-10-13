import type { SearchResult } from '@/api/schemas'

import { resultsSummary } from './results-summary'

// Espaces insécables entre nombre et unité : normalisées pour les comparaisons.
const n = (s: string) => s.replace(/\u00a0/g, ' ')

const result = (distanceM: number, routeDistanceM: number | null): SearchResult => ({
  station: { id: `st-${distanceM}`, name: 'Station', brand: null, location: { lat: 6.37, lng: 2.44 } },
  distanceM,
  routeDistanceM,
  durationS: routeDistanceM === null ? null : 120,
  quantity: 5,
  stale: false,
  stockUpdatedAt: '2026-10-12T18:00:00Z',
  updatedAgoS: 600,
  isOpen: true,
  nextOpening: null,
  servedAt: null,
  reported: false,
})

describe('resultsSummary', () => {
  // Régression : « 4 stations à moins de 500 m » au-dessus d'une première station à 590 m (rayon à
  // vol d'oiseau, élargi par le cache, contre distance routière sur les cartes).
  it('donne la distance de la plus proche, comptée comme sur les cartes', () => {
    const results = [result(450, 2100), result(420, 590), result(480, 900), result(900, 1300)]
    expect(n(resultsSummary(results))).toBe('4 stations · la plus proche à 590 m')
    expect(n(resultsSummary(results))).not.toMatch(/moins de/)
  })

  it('se rabat sur le vol d’oiseau sans distance routière, précédé de ≈ comme sur les cartes', () => {
    expect(n(resultsSummary([result(12_400, null), result(3_200, null)]))).toBe(
      '2 stations · la plus proche à ≈ 3,2 km',
    )
    expect(n(resultsSummary([result(800, 950)], true))).toBe('1 station · la plus proche à ≈ 950 m')
  })

  it('accorde au singulier', () => {
    expect(n(resultsSummary([result(800, 950)]))).toBe('1 station · la plus proche à 950 m')
  })
})
