import { deviceLabel } from '@/features/account/device-label'

import { api, session, unwrap, userAgent } from './client'
import { profileSchema } from './schemas'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const pair = (n: number) => ({
  accessToken: `access-${n}`,
  tokenType: 'Bearer' as const,
  expiresIn: 900,
  refreshToken: `refresh-${n}`,
  refreshExpiresIn: 2_592_000,
})

const profile = {
  id: 'u1',
  email: 'ama@exemple.bj',
  firstName: 'Ama',
  lastName: 'Kossou',
  role: 'user',
  emailVerified: true,
  twoFactorEnabled: false,
  privacyPolicy: {
    acceptedVersion: '1.0',
    acceptedAt: '2026-10-01T10:00:00Z',
    currentVersion: '1.0',
    reacceptRequired: false,
  },
  station: null,
  createdAt: '2026-10-01T10:00:00Z',
}

describe('client API', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('rejoue une requête en 401 après un refresh unique, avec X-Install-Id', async () => {
    await session.signIn(pair(1))
    const seen: { url: string; auth: string | null; install: string | null }[] = []
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init)
      seen.push({ url: req.url, auth: req.headers.get('Authorization'), install: req.headers.get('X-Install-Id') })
      if (req.url.endsWith('/auth/refresh')) return json(200, pair(2))
      return req.headers.get('Authorization') === 'Bearer access-2'
        ? json(200, profile)
        : json(401, { code: 'auth.unauthorized' })
    }) as typeof fetch

    const me = await unwrap(api.GET('/api/v1/me'), profileSchema)

    expect(me.firstName).toBe('Ama')
    expect(seen.map((s) => [s.url.replace(/^https?:\/\/[^/]+/, ''), s.auth])).toEqual([
      ['/api/v1/me', 'Bearer access-1'],
      ['/api/v1/auth/refresh', null],
      ['/api/v1/me', 'Bearer access-2'],
    ])
    expect(seen.every((s) => s.install === '00000000-0000-4000-8000-000000000000')).toBe(true)
  })

  it('traduit un problem+json en ApiError avec message français', async () => {
    globalThis.fetch = jest.fn(async () =>
      json(422, { code: 'search.out_of_coverage', status: 422, title: 'Out of coverage', requestId: 'req-1' }),
    ) as typeof fetch
    await expect(
      unwrap(api.GET('/api/v1/search', { params: { query: { lat: 48.85, lng: 2.35, product_id: 1 } } })),
    ).rejects.toMatchObject({
      status: 422,
      code: 'search.out_of_coverage',
      requestId: 'req-1',
      userMessage: 'Cette position est hors de la zone couverte (Bénin).',
    })
  })
})

describe('userAgent', () => {
  it('donne la version d’Android, pas le niveau d’API (« Android 31 » sur le Galaxy S10)', () => {
    const ua = userAgent('0.1.0', 'android', '12', 'SM-G973F')
    expect(ua).toBe('GoStation/0.1.0 (Android 12; SM-G973F)')
    expect(deviceLabel({ client: 'mobile', userAgent: ua })).toBe('SM-G973F · Android 12')
  })
})
