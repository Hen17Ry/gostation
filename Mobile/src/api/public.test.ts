import { productsQuery } from './public'

describe('productsQuery', () => {
  // Régression : le catalogue restait 24 h en cache ; un produit ajouté ou désactivé par l'admin
  // n'apparaissait qu'au bout d'une journée.
  it('relit le catalogue au plus tard après 1 h, et le garde hors ligne une semaine', () => {
    expect(productsQuery.staleTime).toBeLessThanOrEqual(3600_000)
    expect(productsQuery.gcTime).toBeGreaterThanOrEqual(7 * 24 * 3600_000)
  })
})
