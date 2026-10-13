import tailwind from '../../../tailwind.config.js'

import { WEIGHT } from './text'

describe('Text : familles Geist', () => {
  it('n’utilise jamais un utilitaire de graisse (Android retomberait sur Roboto)', () => {
    // Régression : `font-bold` portait aussi `font-weight: 700` ; Android cherchait alors une
    // variante grasse de Geist_700Bold, ne la trouvait pas et affichait Roboto.
    for (const cls of Object.values(WEIGHT)) {
      expect(cls).not.toMatch(/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/)
      // Régression : `sans` et `mono` sont redéfinis par le preset NativeWind (polices système).
      expect(cls).not.toMatch(/^font-(sans|serif|mono)$/)
    }
  })

  it('chaque graisse a sa famille déclarée dans Tailwind', () => {
    const families = Object.keys((tailwind as { theme: { fontFamily: Record<string, unknown> } }).theme.fontFamily)
    for (const cls of Object.values(WEIGHT)) {
      expect(families).toContain(cls.replace(/^font-/, ''))
    }
  })
})
