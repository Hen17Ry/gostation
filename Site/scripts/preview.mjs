#!/usr/bin/env node
// Aperçu du build (dist/) avec les en-têtes de production : CSP de dist/csp.txt et en-têtes de
// SITE_HEADERS (build/csp.mts), adresses sans extension (/cgu → cgu.html) comme le try_files de
// Caddy, réponses texte compressées (gzip) comme son « encode » : Lighthouse compte les mêmes
// octets qu'en production. Utilisé par les E2E, les vidéos et Lighthouse. Port : PORT (4322).
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'

const { SITE_HEADERS, CSP_FILE } = await import('../build/csp.mts')

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const port = Number(process.env.PORT || 4322)
// Relue à chaque requête : un nouveau build est servi avec sa CSP sans redémarrer. En HTTP local,
// upgrade-insecure-requests ferait passer chaque ressource en HTTPS : retirée ici.
const csp = () =>
  readFileSync(join(dist, CSP_FILE), 'utf8')
    .trim()
    .replace(/;\s*upgrade-insecure-requests/, '')
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
}

function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  for (const candidate of [clean, `${clean}.html`, join(clean, 'index.html')]) {
    const file = join(dist, candidate)
    if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile() && !file.endsWith(CSP_FILE)) return file
  }
  return null
}

const compressible = new Set(['.html', '.js', '.css', '.svg', '.xml', '.txt', '.json'])

/** Envoie le fichier, compressé si le client l'accepte et que le type s'y prête. */
function send(req, res, status, file, headers) {
  const gzip = compressible.has(extname(file)) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
  res.writeHead(status, { ...headers, Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) })
  const stream = createReadStream(file)
  ;(gzip ? stream.pipe(createGzip()) : stream).pipe(res)
}

createServer((req, res) => {
  const file = resolve(req.url === '/' ? '/index.html' : req.url)
  const headers = { ...SITE_HEADERS, 'Content-Security-Policy': csp() }
  if (!file) {
    // Comme Caddy (handle_errors 404) : la page 404 du site.
    const notFound = join(dist, '404.html')
    if (!existsSync(notFound)) return res.writeHead(404, headers).end('Introuvable')
    return send(req, res, 404, notFound, { ...headers, 'Content-Type': types['.html'] })
  }
  send(req, res, 200, file, {
    ...headers,
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
}).listen(port, '127.0.0.1', () => console.log(`Aperçu : http://127.0.0.1:${port}`))
