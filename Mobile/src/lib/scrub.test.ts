import { scrubEvent } from './scrub'

// Ce qui ne doit jamais partir vers le suivi des plantages (règle 2, D90), position comprise.
const secrets = [
  'kofi.mensah@example.bj',
  'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiIxIn0.c2ln',
  'gsr_Zm9vYmFyYmF6cXV4',
  'ExponentPushToken[xxxxABCD]',
  '6.3703',
  '2.4253',
  '203.0.113.7',
  '2001:db8:1:2::1',
  '+22997000000',
]

const leaky = {
  message: 'search failed for kofi.mensah@example.bj near {"lat": 6.3703, "lng": 2.4253}',
  exception: {
    values: [
      {
        type: 'TypeError',
        value:
          'push ExponentPushToken[xxxxABCD] refresh gsr_Zm9vYmFyYmF6cXV4 jwt eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiIxIn0.c2ln',
        stacktrace: { frames: [{ filename: 'app:///index.android.bundle', lineno: 10 }] },
      },
    ],
  },
  request: { url: 'https://api.gostation.bj/api/v1/search?lat=6.3703&lng=2.4253' },
  user: { ip_address: '203.0.113.7' },
  breadcrumbs: [{ data: { url: '/api/v1/routes?lat=6.3703&lng=2.4253' } }],
  tags: { net: '2001:db8:1:2::1', phone: '+22997000000' },
  contexts: { app: { app_version: '0.1.0' } },
}

describe('scrubEvent (mobile)', () => {
  it('ne laisse partir ni position, ni email, ni jeton, ni IP', () => {
    const out = JSON.stringify(scrubEvent(leaky))
    for (const s of secrets) expect(out).not.toContain(s)
  })

  it('garde la pile, la version et la route sans paramètres', () => {
    const out = scrubEvent(leaky)
    expect(out.request).toEqual({ url: 'https://api.gostation.bj/api/v1/search' })
    expect(JSON.stringify(out)).toContain('index.android.bundle')
    expect(JSON.stringify(out)).toContain('0.1.0')
    expect(out.user).toBeUndefined()
    expect(out.breadcrumbs).toBeUndefined()
  })
})
