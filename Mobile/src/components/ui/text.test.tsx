import tailwind from '../../../tailwind.config.js'

import { textClasses, WEIGHT } from './text'

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

describe('Text : une seule famille, une seule couleur', () => {
  const families = (cls: string) => cls.split(' ').filter((c) => c.startsWith('font-'))
  const colors = (cls: string) =>
    cls.split(' ').filter((c) => /^text-(?!(display|title\d|headline|body|callout|subhead|footnote|caption)$)/.test(c))

  // Régression : la colonne des horaires mêlait Geist Mono et Geist (ligne du jour en semibold) :
  // `font-geist-mono` passé en className côtoyait la classe de graisse, l'ordre CSS tranchait.
  it('mono remplace la famille de la graisse au lieu de s’y ajouter', () => {
    for (const weight of ['regular', 'medium', 'semibold', 'bold'] as const) {
      expect(families(textClasses({ variant: 'subhead', weight, mono: true }))).toEqual(['font-geist-mono'])
    }
  })

  it('chaque teinte donne une seule classe de couleur', () => {
    for (const tone of ['default', 'muted', 'onPrimarySubtle', 'success'] as const) {
      expect(colors(textClasses({ tone }))).toHaveLength(1)
    }
  })
})
