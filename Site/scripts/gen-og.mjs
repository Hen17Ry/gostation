#!/usr/bin/env node
// Image de partage (public/og.png, 1200 × 630) : la page source (src/pages/[og].astro, construite
// seulement ici) photographiée par Chromium avec les vraies polices. Usage : npm run gen:og
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'test-results', 'og-build')
rmSync(out, { recursive: true, force: true })
execFileSync('npx', ['astro', 'build', '--outDir', out], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, GEN_OG: '1', ASTRO_TELEMETRY_DISABLED: '1' },
})

const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
}
const server = createServer((req, res) => {
  const path = req.url.split('?')[0]
  const file = [join(out, path), join(out, `${path}.html`)].find((f) => existsSync(f) && statSync(f).isFile())
  if (!file) return res.writeHead(404).end()
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: 'light' })
await page.goto(`http://127.0.0.1:${server.address().port}/og-source`)
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: join(root, 'public', 'og.png') })
await browser.close()
server.close()
rmSync(out, { recursive: true, force: true })
console.log('✓ public/og.png')
