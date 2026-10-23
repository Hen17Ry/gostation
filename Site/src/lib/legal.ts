/**
 * Textes légaux du site, depuis leur source unique (docs/legal/*.md) et l'analyseur de l'app
 * (Mobile/src/features/legal/markdown.ts). Adresses fixes : Google OAuth et Google Play pointent
 * dessus ; /cgu et /cgu.html servent la même page (Caddy : try_files {path} {path}.html).
 */
import { parseMarkdown, type LegalDocument } from '../../../Mobile/src/features/legal/markdown'

export const LEGAL_PAGES = [
  { slug: 'politique-confidentialite', file: 'politique-confidentialite.md', route: '/legal/privacy' },
  { slug: 'cgu', file: 'cgu.md', route: '/legal/terms' },
  { slug: 'suppression-compte', file: 'suppression-compte.md', route: '/legal/delete-account' },
] as const

export type LegalSlug = (typeof LEGAL_PAGES)[number]['slug']

/** Liens internes de l'app (/legal/privacy) → adresses du site. */
export const legalHref = (href: string) => {
  const page = LEGAL_PAGES.find((p) => p.route === href)
  return page ? `/${page.slug}` : href
}

// Lus au build (Vite) depuis la source unique, à côté du dépôt du site.
const sources = import.meta.glob<string>('../../../docs/legal/*.md', { query: '?raw', import: 'default', eager: true })

export function readLegal(file: string): LegalDocument {
  const src = Object.entries(sources).find(([path]) => path.endsWith(`/${file}`))?.[1]
  if (src === undefined) throw new Error(`texte légal introuvable : ${file}`)
  return parseMarkdown(src)
}
