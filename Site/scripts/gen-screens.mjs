#!/usr/bin/env node
// Images fixes de l'écran du téléphone (public/screens/*.webp) pour la version réduite et la page
// sans JavaScript : le même dessin que l'animation (src/lib/phone/painter.ts), peint dans Chromium.
// Prérequis : npm run build (la carte claire vient de dist/maps/). Usage : npm run gen:screens
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import { build } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const harness = join(root, 'test-results', 'screens-harness')
export const SCREENS = {
  recherche: { kind: 'search', product: 'gaz', size: 10 },
  resultats: { kind: 'results' },
  guidage: { kind: 'navigation', step: 0, progress: 0.4 },
  arrivee: { kind: 'arrived' },
  stocks: { kind: 'stocks', count: 14, confirmed: true, reminder: 0 },
  rappel: { kind: 'stocks', count: 14, confirmed: false, reminder: 1 },
}

await build({
  root: join(root, 'scripts', 'screens'),
  logLevel: 'warn',
  resolve: { alias: { '@': join(root, 'src') } },
  build: { outDir: harness, emptyOutDir: true },
})

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
}
const server = createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  const file = [join(harness, url), join(root, 'dist', url)].find((f) => existsSync(f) && statSync(f).isFile())
  if (!file) return res.writeHead(404).end()
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${server.address().port}/`)
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCREENS)
const urls = await page.evaluate(
  (list) => window.renderScreens(list),
  names.map((n) => SCREENS[n]),
)
const out = process.env.SCREENS_OUT || join(root, 'public', 'screens')
mkdirSync(out, { recursive: true })
names.forEach((name, i) => {
  const data = Buffer.from(urls[i].split(',')[1], 'base64')
  writeFileSync(join(out, `${name}.webp`), data)
  console.log(`${name}.webp ${Math.round(data.length / 1024)} Ko`)
})
if (process.env.SCREENS_SHOT) await page.screenshot({ path: process.env.SCREENS_SHOT, fullPage: true })
await browser.close()
server.close()
