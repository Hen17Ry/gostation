import { parseInline, parseMarkdown, plain } from './markdown'

describe('parseMarkdown', () => {
  const doc = parseMarkdown(`---
title: Politique
version: 1.1
---

# Titre

> **PROJET** à valider.

Premier paragraphe
sur deux lignes, avec un [lien](/legal/terms).

## Section

- un
- deux
  suite

1. premier
2. second

| Donnée | Durée |
|---|---|
| Compte | 24 mois |
`)

  it('lit l’en-tête', () => {
    expect(doc.meta).toEqual({ title: 'Politique', version: '1.1' })
  })

  it('découpe les blocs', () => {
    expect(doc.blocks.map((b) => b.type)).toEqual(['heading', 'note', 'paragraph', 'heading', 'list', 'list', 'table'])
    const [h1, note, para, , ul, ol, table] = doc.blocks
    expect(h1).toEqual({ type: 'heading', level: 1, text: [{ text: 'Titre' }] })
    expect(note).toEqual({ type: 'note', text: [{ text: 'PROJET', bold: true }, { text: ' à valider.' }] })
    expect(para?.type === 'paragraph' && plain(para.text)).toBe('Premier paragraphe sur deux lignes, avec un lien.')
    expect(ul?.type === 'list' && ul.items.map(plain)).toEqual(['un', 'deux suite'])
    expect(ol?.type === 'list' && ol.ordered).toBe(true)
    expect(table?.type === 'table' && table.rows.map((r) => r.map(plain))).toEqual([['Compte', '24 mois']])
  })
})

describe('parseInline', () => {
  it('reconnaît gras, italique, code et liens', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.bj)')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', italic: true },
      { text: ' ' },
      { text: 'd', code: true },
      { text: ' ' },
      { text: 'e', href: 'https://x.bj' },
    ])
  })

  it('laisse le texte sans balisage tel quel', () => {
    expect(parseInline('[À COMPLÉTER : adresse]')).toEqual([{ text: '[À COMPLÉTER : adresse]' }])
  })
})
