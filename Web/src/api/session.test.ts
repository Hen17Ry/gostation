import { describe, expect, it, vi } from 'vitest'

import { memoryLocks, memoryStorage } from '@/test/memory-storage'

import { createSession } from './session'

const BASE = 'http://admin.test'
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

/** API factice : 401 tant qu'aucun refresh n'a réussi ; le refresh renvoie un nouveau jeton CSRF. */
function fakeApi(opts: { refreshOk?: boolean; refreshDelay?: number } = {}) {
  const state = { valid: false, refreshes: 0, csrfFetches: 0, bodies: [] as string[], csrf: [] as (string | null)[] }
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    const path = new URL(req.url).pathname
    if (path === '/api/v1/auth/refresh') {
      state.refreshes++
      await tick(opts.refreshDelay ?? 10)
      if (opts.refreshOk === false) return new Response(null, { status: 401 })
      state.valid = true
      return Response.json({ csrfToken: `csrf-${state.refreshes + 1}`, expiresIn: 900 })
    }
    if (path === '/api/v1/auth/admin/login') return new Response(null, { status: 401 })
    if (path === '/api/v1/auth/csrf') {
      state.csrfFetches++
      return Response.json({ csrfToken: `csrf-${state.refreshes + 1}` })
    }
    if (!state.valid) return new Response(null, { status: 401 })
    state.csrf.push(req.headers.get('X-CSRF-Token'))
    if (req.method !== 'GET') state.bodies.push(await req.text())
    return Response.json({ ok: true })
  })
  return { fetch, state }
}

function newSession(api: ReturnType<typeof fakeApi>, extra: Partial<Parameters<typeof createSession>[0]> = {}) {
  const storage = memoryStorage()
  storage.setItem('gs-signed-in', '1') // session ouverte avant le rechargement de la page
  const onExpired = vi.fn()
  const session = createSession({
    baseUrl: BASE,
    fetch: api.fetch,
    storage,
    locks: null,
    readCookie: () => '',
    onExpired,
    ...extra,
  })
  return { session, storage, onExpired }
}

const get = (path = '/api/v1/admin/dashboard') => new Request(`${BASE}${path}`)

describe('refresh single-flight (règle 15)', () => {
  it('un seul POST /auth/refresh pour des 401 concurrents, puis toutes les requêtes sont rejouées', async () => {
    const api = fakeApi()
    const { session } = newSession(api)
    const responses = await Promise.all(Array.from({ length: 6 }, () => session.authFetch(get())))
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200])
    expect(api.state.refreshes).toBe(1)
  })

  it('rejoue une écriture avec son corps et le jeton CSRF renouvelé', async () => {
    const api = fakeApi()
    const { session } = newSession(api)
    const req = new Request(`${BASE}/api/v1/admin/products`, {
      method: 'POST',
      body: JSON.stringify({ label: 'Gaz 12,5 kg' }),
    })
    const res = await session.authFetch(req)
    expect(res.status).toBe(200)
    expect(api.state.bodies).toEqual(['{"label":"Gaz 12,5 kg"}'])
    expect(api.state.csrf).toEqual(['csrf-2'])
  })

  it('ne relance pas de refresh pour une requête partie avant un refresh déjà abouti', async () => {
    let now = 0
    const api = fakeApi()
    let releaseLate!: () => void
    const late = new Promise<void>((r) => (releaseLate = r))
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init)
      if (req.headers.get('X-Late') === '1' && !api.state.valid) {
        await late // 401 reçu après la fin du refresh déclenché par une autre requête
        return new Response(null, { status: 401 })
      }
      return api.fetch(input, init)
    })
    const { session } = newSession({ ...api, fetch }, { now: () => now })
    const slow = session.authFetch(new Request(`${BASE}/api/v1/me`, { headers: { 'X-Late': '1' } }))
    now = 10
    const fast = session.authFetch(get())
    now = 100
    expect((await fast).status).toBe(200)
    releaseLate()
    expect((await slow).status).toBe(200)
    expect(api.state.refreshes).toBe(1)
  })

  it('refresh refusé : session expirée signalée une seule fois, sans boucle de refresh', async () => {
    const api = fakeApi({ refreshOk: false })
    const { session, onExpired, storage } = newSession(api)
    const res = await Promise.all([session.authFetch(get()), session.authFetch(get()), session.authFetch(get())])
    expect(res.map((r) => r.status)).toEqual([401, 401, 401])
    expect(api.state.refreshes).toBe(1)
    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(storage.getItem('gs-signed-in')).toBeNull()
    expect(session.consumeExpired()).toBe(true)
    expect(session.consumeExpired()).toBe(false)
    // Plus de session : un nouveau 401 ne déclenche plus rien.
    expect((await session.authFetch(get())).status).toBe(401)
    expect(api.state.refreshes).toBe(1)
  })

  it('jamais de refresh sur les routes de connexion, ni sans session', async () => {
    const api = fakeApi()
    const { session } = newSession(api)
    expect((await session.authFetch(get('/api/v1/auth/admin/login'))).status).toBe(401)
    const anonymous = createSession({
      baseUrl: BASE,
      fetch: api.fetch,
      storage: memoryStorage(),
      locks: null,
      readCookie: () => '',
    })
    expect((await anonymous.authFetch(get())).status).toBe(401)
    expect(api.state.refreshes).toBe(0)
  })

  it('entre onglets : un onglet qui attend le verrou ne refait pas le refresh déjà fait par l’autre', async () => {
    const api = fakeApi({ refreshDelay: 20 })
    const storage = memoryStorage()
    storage.setItem('gs-signed-in', '1')
    const locks = memoryLocks()
    const tabA = createSession({ baseUrl: BASE, fetch: api.fetch, storage, locks, readCookie: () => '' })
    const tabB = createSession({ baseUrl: BASE, fetch: api.fetch, storage, locks, readCookie: () => '' })
    const [a, b] = await Promise.all([tabA.authFetch(get()), tabB.authFetch(get())])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(api.state.refreshes).toBe(1)
  })

  it('jeton CSRF : cookie gs_csrf s’il est lisible, sinon la copie en mémoire, jamais le stockage', () => {
    const storage = memoryStorage()
    const withCookie = createSession({
      baseUrl: BASE,
      storage,
      locks: null,
      readCookie: () => 'a=1; gs_csrf=from-cookie',
    })
    expect(withCookie.getCsrfToken()).toBe('from-cookie')
    const crossOrigin = createSession({ baseUrl: BASE, storage, locks: null, readCookie: () => '' })
    crossOrigin.setCsrfToken('from-login')
    expect(crossOrigin.getCsrfToken()).toBe('from-login')
    expect(JSON.stringify([storage.getItem('gs-signed-in'), storage.getItem('gs-csrf')])).toBe('["1",null]')
  })

  it('après un rechargement, le jeton est relu via GET /auth/csrf, une seule fois pour des écritures concurrentes', async () => {
    const api = fakeApi()
    api.state.valid = true // cookies de session encore valides
    const { session } = newSession(api)
    const post = () => new Request(`${BASE}/api/v1/admin/products`, { method: 'POST', body: '{}' })
    const res = await Promise.all([session.authFetch(post()), session.authFetch(post()), session.authFetch(post())])
    expect(res.map((r) => r.status)).toEqual([200, 200, 200])
    expect(api.state.csrfFetches).toBe(1)
    expect(api.state.csrf).toEqual(['csrf-1', 'csrf-1', 'csrf-1'])
    expect(api.state.refreshes).toBe(0)
  })
})
