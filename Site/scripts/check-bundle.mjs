#!/usr/bin/env node
// Budget du JS initial (storyboard §3) : les scripts que la page charge d'emblée (modules et
// modulepreload) doivent tenir sous 150 Ko gzip. Three.js et les scènes chargées à la demande
// sont listés pour information.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = 150
const dist = new URL('../dist/', import.meta.url).pathname
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const initial = [
  ...new Set([...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1])),
]

const gz = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length / 1024
const fmt = (kb) => `${kb.toFixed(1).padStart(7)} Ko`

// Imports statiques des modules initiaux (chunks partagés) : chargés d'emblée eux aussi.
const seen = new Set()
const walk = (file) => {
  if (seen.has(file)) return
  seen.add(file)
  const code = readFileSync(join(dist, file), 'utf8')
  for (const m of code.matchAll(/(?:^|[;\s])import\s*(?:[^'"()]*?from\s*)?["']\.\/([^"']+\.js)["']/g))
    walk(`assets/${m[1]}`)
}
initial.forEach(walk)

let total = 0
console.log('JS initial (modules de la page et leurs imports statiques) :')
for (const f of seen) {
  const kb = gz(f)
  total += kb
  console.log(`  ${fmt(kb)}  ${f}`)
}
console.log(`  ${fmt(total)}  TOTAL (budget ${BUDGET_KB} Ko gzip)\n`)

const lazy = readdirSync(join(dist, 'assets'))
  .filter((f) => f.endsWith('.js') && !seen.has(`assets/${f}`))
  .map((f) => ({ f, kb: gz(`assets/${f}`) }))
  .sort((a, b) => b.kb - a.kb)
console.log('Chargés à la demande (ou jamais, comme le runtime React sans îlot) :')
for (const { f, kb } of lazy.slice(0, 8)) console.log(`  ${fmt(kb)}  assets/${f}`)

if (total > BUDGET_KB) {
  console.error(`\n✗ JS initial ${total.toFixed(1)} Ko gzip > ${BUDGET_KB} Ko`)
  process.exit(1)
}
console.log(`\n✓ JS initial ${total.toFixed(1)} Ko gzip ≤ ${BUDGET_KB} Ko`)
