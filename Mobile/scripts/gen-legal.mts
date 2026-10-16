/**
 * Textes légaux depuis leur source unique, docs/legal/*.md :
 *
 *   node scripts/gen-legal.mts               src/features/legal/content.generated.ts (l'app)
 *   node scripts/gen-legal.mts --html <dir>  pages HTML statiques (make legal-html)
 *
 * Node 24 exécute ce fichier TypeScript directement. Le test content.test.ts vérifie que le
 * fichier généré correspond au Markdown.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { type Block, type Inline, type LegalDocument, parseMarkdown } from '../src/features/legal/markdown.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = {
  privacyPolicy: {
    md: 'politique-confidentialite.md',
    html: 'politique-confidentialite.html',
    route: '/legal/privacy',
  },
  terms: { md: 'cgu.md', html: 'cgu.html', route: '/legal/terms' },
} as const

const read = (name: string): LegalDocument => parseMarkdown(readFileSync(`${root}../docs/legal/${name}`, 'utf8'))

function generated(): string {
  const docs = Object.entries(sources).map(
    ([key, s]) => `export const ${key}: LegalDocument = ${JSON.stringify(read(s.md), null, 2)}\n`,
  )
  return `// Généré par scripts/gen-legal.mts depuis docs/legal/*.md (npm run gen:legal) : ne pas modifier.
import type { LegalDocument } from './markdown'

${docs.join('\n')}`
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const routes: Record<string, string> = Object.fromEntries(Object.values(sources).map((s) => [s.route, s.html]))

function inline(text: Inline[]): string {
  return text
    .map((s) => {
      let h = escape(s.text)
      if (s.code) h = `<code>${h}</code>`
      if (s.italic) h = `<em>${h}</em>`
      if (s.bold) h = `<strong>${h}</strong>`
      if (s.href) {
        const href = routes[s.href] ?? s.href
        const external = /^https?:/.test(href) ? ' rel="noopener noreferrer"' : ''
        h = `<a href="${escape(href)}"${external}>${h}</a>`
      }
      return h
    })
    .join('')
}

function block(b: Block): string {
  switch (b.type) {
    case 'heading':
      return `<h${b.level}>${inline(b.text)}</h${b.level}>`
    case 'paragraph':
      return `<p>${inline(b.text)}</p>`
    case 'note':
      return `<aside class="note"><p>${inline(b.text)}</p></aside>`
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul'
      return `<${tag}>${b.items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`
    }
    case 'table':
      return `<div class="table"><table><thead><tr>${b.header.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`
  }
}

const STYLE = `:root{color-scheme:light dark;--fg:#1c1917;--muted:#57534e;--bg:#fffdfb;--line:#e7e5e4;--brand:#b83a00;--note:#fff4e5}
@media (prefers-color-scheme:dark){:root{--fg:#f5f5f4;--muted:#d6d3d1;--bg:#141210;--line:#3a3532;--brand:#ff9a5c;--note:#2a2016}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:46rem;margin:0 auto;padding:2rem 1.25rem 4rem}h1{font-size:1.75rem;line-height:1.25}h2{font-size:1.25rem;margin-top:2.25rem}h3{font-size:1.05rem;margin-top:1.5rem}
a{color:var(--brand);text-underline-offset:3px}a:focus-visible{outline:2px solid var(--brand);outline-offset:2px}.meta{color:var(--muted);font-size:.9rem}
.note{background:var(--note);border-left:4px solid var(--brand);border-radius:6px;padding:.25rem 1rem;margin:1.25rem 0}
.table{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.95rem}th,td{border:1px solid var(--line);padding:.5rem .65rem;text-align:left;vertical-align:top}th{background:var(--note)}
nav{display:flex;gap:1rem;font-size:.95rem}`

function page(doc: LegalDocument, title: string): string {
  const nav = Object.values(sources)
    .map((s) => `<a href="${s.html}">${escape(read(s.md).meta.title ?? s.html)}</a>`)
    .join('')
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · GoStation</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<nav aria-label="Textes légaux">${nav}</nav>
<p class="meta">Version ${escape(doc.meta.version ?? '?')} · ${escape(doc.meta.updated ?? '')}</p>
${doc.blocks.map(block).join('\n')}
</main>
</body>
</html>
`
}

const args = process.argv.slice(2)
if (args[0] === '--html') {
  const out = args[1]
  if (!out) throw new Error('usage : gen-legal.mts --html <dossier>')
  mkdirSync(out, { recursive: true })
  for (const s of Object.values(sources)) {
    const doc = read(s.md)
    writeFileSync(`${out}/${s.html}`, page(doc, doc.meta.title ?? s.html))
  }
  writeFileSync(
    `${out}/index.html`,
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${sources.privacyPolicy.html}"><title>GoStation</title>`,
  )
  console.log(`✔ HTML des textes légaux dans ${out}`)
} else {
  writeFileSync(`${root}src/features/legal/content.generated.ts`, generated())
  console.log('✔ src/features/legal/content.generated.ts')
}
