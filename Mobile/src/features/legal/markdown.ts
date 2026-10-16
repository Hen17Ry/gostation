/**
 * Markdown des textes légaux (docs/legal/*.md, source unique) : un sous-ensemble volontairement
 * restreint, lu par le générateur (scripts/gen-legal.mts) pour l'app et pour le HTML statique.
 * Blocs : en-tête `---` (clé: valeur), titres #, ##, ###, paragraphes, listes - et 1., citations >,
 * tableaux | a | b |. En ligne : **gras**, *italique*, `code`, [lien](url). Rien d'autre : un
 * texte légal reste simple, et toute construction inconnue est rendue comme du texte.
 */

export interface Inline {
  text: string
  bold?: true
  italic?: true
  code?: true
  href?: string
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: Inline[] }
  | { type: 'paragraph'; text: Inline[] }
  | { type: 'note'; text: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }

export interface LegalDocument {
  meta: Record<string, string>
  blocks: Block[]
}

const LIST = /^(\s*)(?:[-*]|(\d+)\.)\s+(.*)$/
const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/

/** Découpe un texte en segments : gras, italique, code et liens (non imbriqués, sauf le gras d'un lien). */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*([^*\s][^*]*)\*/g
  let last = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out.push({ text: src.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ text: m[1], bold: true })
    else if (m[2] !== undefined) out.push({ text: m[2], href: m[3]! })
    else if (m[4] !== undefined) out.push({ text: m[4], code: true })
    else if (m[5] !== undefined) out.push({ text: m[5], italic: true })
    last = re.lastIndex
  }
  if (last < src.length) out.push({ text: src.slice(last) })
  return out
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => parseInline(c.trim()))

export function parseMarkdown(src: string): LegalDocument {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const meta: Record<string, string> = {}
  let i = 0
  if (lines[0]?.trim() === '---') {
    for (i = 1; i < lines.length && lines[i]!.trim() !== '---'; i++) {
      const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]!)
      if (m) meta[m[1]!] = m[2]!.trim()
    }
    i++
  }
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: parseInline(para.join(' ')) })
    para = []
  }
  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (trimmed === '' || /^(-{3,}|\*{3,})$/.test(trimmed)) {
      flush()
      i++
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3, text: parseInline(heading[2]!) })
      i++
      continue
    }
    if (trimmed.startsWith('>')) {
      flush()
      const quote: string[] = []
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        quote.push(lines[i]!.trim().replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'note', text: parseInline(quote.join(' ')) })
      continue
    }
    if (trimmed.startsWith('|') && TABLE_SEPARATOR.test(lines[i + 1]?.trim() ?? '')) {
      flush()
      const header = cells(trimmed)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(cells(lines[i]!))
        i++
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }
    const item = LIST.exec(line)
    if (item) {
      flush()
      const ordered = item[2] !== undefined
      const items: string[] = []
      while (i < lines.length) {
        const m = LIST.exec(lines[i]!)
        if (m) items.push(m[3]!)
        else if (lines[i]!.trim() !== '' && /^\s+/.test(lines[i]!) && items.length) {
          items[items.length - 1] += ` ${lines[i]!.trim()}`
        } else break
        i++
      }
      blocks.push({ type: 'list', ordered, items: items.map(parseInline) })
      continue
    }
    para.push(trimmed)
    i++
  }
  flush()
  return { meta, blocks }
}

/** Texte brut d'une suite de segments (libellés d'accessibilité, titres). */
export const plain = (text: Inline[]) => text.map((s) => s.text).join('')
