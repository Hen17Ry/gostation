import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ADMIN_HEADERS, apiOriginOf, contentSecurityPolicy, CSP_FILE, inlineScriptHashes } from './csp.ts'

const sha = (s: string) => `sha256-${createHash('sha256').update(s).digest('base64')}`

describe('CSP de l’admin', () => {
  it('autorise les scripts en ligne par empreinte, jamais en bloc', () => {
    const html = `<head><script>a()</script><script type="module" src="/assets/i.js"></script><script>b()</script></head>`
    expect(inlineScriptHashes(html)).toEqual([sha('a()'), sha('b()')])
    const csp = contentSecurityPolicy({ scriptHashes: inlineScriptHashes(html) })
    const scriptSrc = csp.split('; ').find((d: string) => d.startsWith('script-src '))
    expect(scriptSrc).toBe(`script-src 'self' '${sha('a()')}' '${sha('b()')}'`)
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  it('ouvre la carte (workers, blobs, OpenFreeMap) et l’API de production', () => {
    const csp = contentSecurityPolicy({ apiOrigin: apiOriginOf('https://api.gostation.bj/'), scriptHashes: [] })
    expect(csp).toContain("connect-src 'self' https://api.gostation.bj https://tiles.openfreemap.org blob:")
    expect(csp).toContain("worker-src 'self' blob:")
    expect(csp).toContain("img-src 'self' data: blob:")
    expect(apiOriginOf('')).toBeUndefined()
    const withErrors = contentSecurityPolicy({
      errorsOrigin: apiOriginOf('https://public@errors.gostation.bj/2'),
      scriptHashes: [],
    })
    expect(withErrors).toContain("connect-src 'self' https://errors.gostation.bj https://tiles.openfreemap.org blob:")
    expect(apiOriginOf('/api')).toBeUndefined()
  })

  it('Caddy sert les mêmes en-têtes que vite preview', () => {
    // Vitest tourne depuis Web/.
    const caddyfile = readFileSync(resolve(process.cwd(), '../deploy/Caddyfile'), 'utf8')
    const admin = caddyfile.slice(caddyfile.indexOf('admin.{$DOMAIN} {'))
    expect(admin).toContain(`Content-Security-Policy "{file./srv/admin/${CSP_FILE}}"`)
    for (const [name, value] of Object.entries(ADMIN_HEADERS)) {
      expect(admin).toContain(`${name} "${value}"`)
    }
  })
})
