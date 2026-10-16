import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PRIVACY_POLICY_VERSION } from '@/api/account'

import { privacyPolicy, terms } from './content.generated'
import { parseMarkdown } from './markdown'

const legal = (name: string) => parseMarkdown(readFileSync(join(__dirname, '../../../../docs/legal', name), 'utf8'))

describe('textes légaux', () => {
  it('le contenu de l’app correspond à docs/legal (sinon : npm run gen:legal)', () => {
    expect(privacyPolicy).toEqual(legal('politique-confidentialite.md'))
    expect(terms).toEqual(legal('cgu.md'))
  })

  it('l’inscription accepte la version de la politique livrée avec l’app', () => {
    expect(PRIVACY_POLICY_VERSION).toBe(privacyPolicy.meta.version)
    expect(privacyPolicy.meta.version).toMatch(/^\d+\.\d+$/)
  })

  it('chaque texte est marqué comme projet tant qu’il n’est pas validé', () => {
    for (const doc of [privacyPolicy, terms]) {
      expect(doc.blocks.some((b) => b.type === 'note' && b.text.some((s) => s.text.includes('PROJET')))).toBe(true)
    }
  })

  it('les liens internes visent des écrans de l’app', () => {
    const links = [privacyPolicy, terms].flatMap((d) =>
      d.blocks.flatMap((b) => ('text' in b ? b.text : b.type === 'list' ? b.items.flat() : [])).filter((s) => s.href),
    )
    for (const l of links.filter((s) => s.href!.startsWith('/'))) {
      expect(['/legal/privacy', '/legal/terms']).toContain(l.href)
    }
  })
})
