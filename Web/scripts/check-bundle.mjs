#!/usr/bin/env node
// Budget du JS initial (CLAUDE.md, étape 8A) : le point d'entrée et tout ce que index.html
// précharge (modulepreload) doivent tenir sous 200 Ko gzip. Les chunks de route et les modules
// chargés à la demande (MapLibre, calendrier, palette ⌘K, QR code) sont listés pour information.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = 200
const dist = new URL('../dist/', import.meta.url).pathname
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1])

const gz = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length / 1024
const fmt = (kb) => `${kb.toFixed(1).padStart(7)} Ko`

let total = 0
console.log('JS initial (entrée + modulepreload) :')
for (const f of initial) {
  const kb = gz(f)
  total += kb
  console.log(`  ${fmt(kb)}  ${f}`)
}
console.log(`  ${fmt(total)}  TOTAL (budget ${BUDGET_KB} Ko gzip)\n`)

const lazy = readdirSync(join(dist, 'assets'))
  .filter((f) => f.endsWith('.js') && !initial.includes(`assets/${f}`))
  .map((f) => ({ f, kb: gz(`assets/${f}`), raw: statSync(join(dist, 'assets', f)).size }))
  .sort((a, b) => b.kb - a.kb)
console.log('Plus gros chunks chargés à la demande :')
for (const { f, kb } of lazy.slice(0, 8)) console.log(`  ${fmt(kb)}  assets/${f}`)

if (total > BUDGET_KB) {
  console.error(`\n✗ JS initial ${total.toFixed(1)} Ko gzip > ${BUDGET_KB} Ko`)
  process.exit(1)
}
console.log(`\n✓ JS initial ${total.toFixed(1)} Ko gzip ≤ ${BUDGET_KB} Ko`)
