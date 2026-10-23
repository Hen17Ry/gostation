import { describe, expect, it } from 'vitest'

import { contentSecurityPolicy, inlineHashes, inlineViolations } from './csp.mts'

describe('CSP du site', () => {
  it('empreinte des scripts exécutables seulement (pas du JSON-LD ni des scripts externes)', () => {
    const html = `<script>a()</script><script type="module">b()</script><script type="application/ld+json">{}</script><script src="/x.js"></script><style>p{}</style>`
    const h = inlineHashes(html)
    expect(h.scripts).toHaveLength(2)
    expect(h.styles).toHaveLength(1)
    expect(h.scripts[0]).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/)
  })

  it('refuse les attributs style et les gestionnaires en ligne', () => {
    expect(inlineViolations('<div style="color:red">x</div>')).toHaveLength(1)
    expect(inlineViolations('<button onclick="x()">x</button>')).toHaveLength(1)
    expect(inlineViolations('<path d="M0 0" fill="url(#a)"></path><p>style="ok" dans le texte</p>')).toHaveLength(0)
  })

  it('sans unsafe-inline ni origine tierce', () => {
    const csp = contentSecurityPolicy({ scripts: ["'sha256-x'"], styles: [] })
    expect(csp).not.toContain('unsafe')
    expect(csp).not.toMatch(/https?:/)
    expect(csp).toContain("script-src 'self' 'sha256-x'")
    expect(csp).toContain("frame-ancestors 'none'")
  })
})
