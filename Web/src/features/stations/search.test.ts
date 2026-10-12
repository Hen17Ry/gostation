import { describe, expect, it } from 'vitest'

import { activeStationFilters, stationSearchSchema, toStationFilters } from './search'

describe('filtres de la liste des stations (URL → API)', () => {
  it('en attente par défaut, booléens envoyés seulement s’ils sont actifs', () => {
    expect(toStationFilters({})).toEqual({ status: 'pending' })
    expect(
      toStationFilters({
        status: 'all',
        q: 'Akpakpa',
        freshness: 'stale',
        excluded: true,
        noHours: false,
        cursor: 'c1',
      }),
    ).toEqual({ status: 'all', q: 'Akpakpa', freshness: 'stale', excluded: true, cursor: 'c1' })
  })

  it('un paramètre d’URL invalide est ignoré, pas une erreur', () => {
    expect(stationSearchSchema.parse({ status: 'deleted', freshness: 'fresh', reported: 'oui' })).toEqual({})
  })

  it('compte les filtres actifs (hors statut)', () => {
    expect(activeStationFilters({ status: 'all' })).toBe(0)
    expect(activeStationFilters({ q: 'x', reported: true, managerInactive: true })).toBe(3)
  })
})
