import { t } from '.'

describe('textes', () => {
  // Régression : bandeau « Hors connexion » suivi de « Hors connexion : derniers résultats… ».
  it('le bandeau hors connexion ne répète pas son titre', () => {
    expect(t.search.offlineResults.toLowerCase()).not.toContain(t.common.offline.toLowerCase())
  })
})
