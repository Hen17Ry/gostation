import { createSession } from './session'

const pair = (n: number) => ({
  accessToken: `access-${n}`,
  tokenType: 'Bearer',
  expiresIn: 900,
  refreshToken: `refresh-${n}`,
  refreshExpiresIn: 2_592_000,
})

function memoryStore(initial?: string) {
  const m = new Map<string, string>(initial ? [['gs.refresh-token', initial]] : [])
  return {
    getItemAsync: jest.fn(async (k: string) => m.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void m.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void m.delete(k)),
    map: m,
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('session (règle 15 : refresh single-flight)', () => {
  it('ne fait qu’un seul POST /auth/refresh pour des demandes concurrentes', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fetch = jest.fn(async () => {
      calls++
      await gate
      return json(200, pair(2))
    })
    const store = memoryStore('refresh-1')
    const s = createSession({ baseUrl: 'http://api', fetch: fetch as never, store })

    const all = Promise.all([s.accessToken(), s.accessToken(), s.refresh(), s.accessToken()])
    await new Promise((r) => setTimeout(r, 0))
    release()
    const tokens = await all

    expect(calls).toBe(1)
    expect(tokens).toEqual(['access-2', 'access-2', true, 'access-2'])
    expect(store.map.get('gs.refresh-token')).toBe('refresh-2')
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body).toEqual({ refreshToken: 'refresh-1' })
  })

  it('ne renouvelle pas une seconde fois une requête partie avant le dernier refresh', async () => {
    let t = 1_000
    const fetch = jest.fn(async () => json(200, pair(++t)))
    const s = createSession({ baseUrl: 'http://api', fetch: fetch as never, store: memoryStore('r'), now: () => t })
    const sentAt = t
    t += 10
    await s.refresh()
    // Une requête partie avant ce refresh revient en 401 : on rejoue avec le nouveau jeton.
    expect(await s.refresh(sentAt)).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('efface la session si le refresh est refusé (401)', async () => {
    const store = memoryStore('revoked')
    const onChange = jest.fn()
    const s = createSession({
      baseUrl: 'http://api',
      fetch: (async () => json(401, { code: 'auth.invalid_refresh_token' })) as never,
      store,
    })
    s.onChange(onChange)
    expect(await s.accessToken()).toBeNull()
    expect(s.hasSession()).toBe(false)
    expect(store.map.size).toBe(0)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('garde la session si le réseau est indisponible', async () => {
    const s = createSession({
      baseUrl: 'http://api',
      fetch: (async () => {
        throw new TypeError('Network request failed')
      }) as never,
      store: memoryStore('r'),
    })
    expect(await s.accessToken()).toBeNull()
    expect(s.hasSession()).toBe(true)
  })

  it('réutilise l’access token tant qu’il est valide', async () => {
    const fetch = jest.fn()
    let t = 0
    const s = createSession({ baseUrl: 'http://api', fetch, store: memoryStore(), now: () => t })
    await s.signIn(pair(1) as never)
    t = 60_000
    expect(await s.accessToken()).toBe('access-1')
    expect(fetch).not.toHaveBeenCalled()
  })
})
