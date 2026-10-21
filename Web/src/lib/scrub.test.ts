import { describe, expect, it } from 'vitest'

import { scrubEvent } from './scrub'

// Ce qui ne doit jamais partir vers le suivi des plantages (règle 2, D90).
const secrets = [
  'awa.houngbo@example.bj',
  'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiIxIn0.c2ln',
  'gsr_Zm9vYmFyYmF6cXV4',
  'ExponentPushToken[xxxxABCD]',
  'Bearer abc.def',
  '6.3703',
  '2.4253',
  '203.0.113.7',
  '2001:db8:1:2::1',
  '+22997000000',
  'Houngbo',
]

const leaky = {
  message: 'user awa.houngbo@example.bj at lat=6.3703&lng=2.4253 from 203.0.113.7',
  exception: {
    values: [
      {
        type: 'TypeError',
        value: 'x is undefined (token eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiIxIn0.c2ln, gsr_Zm9vYmFyYmF6cXV4) at 12:30:45',
        stacktrace: { frames: [{ filename: 'https://admin.gostation.bj/assets/index-abc.js', lineno: 1, colno: 2 }] },
      },
    ],
  },
  request: {
    url: 'https://admin.gostation.bj/users?q=Houngbo&user=01a1#x',
    headers: { 'User-Agent': 'x', Authorization: 'Bearer abc.def' },
    cookies: { gs_csrf: 'c' },
  },
  user: { email: 'awa.houngbo@example.bj', ip_address: '203.0.113.7' },
  breadcrumbs: [{ message: 'GET /api/v1/search?lat=6.3703&lng=2.4253' }],
  tags: { push: 'ExponentPushToken[xxxxABCD]', phone: '+22997000000', ip6: '2001:db8:1:2::1' },
  extra: { body: { email: 'awa.houngbo@example.bj' } },
}

describe('scrubEvent', () => {
  it('ne laisse partir aucune donnée personnelle', () => {
    const out = JSON.stringify(scrubEvent(leaky))
    for (const s of secrets) expect(out, s).not.toContain(s)
  })

  it('garde de quoi diagnostiquer', () => {
    const out = scrubEvent(leaky)
    expect(out.request).toEqual({ url: 'https://admin.gostation.bj/users' })
    expect(JSON.stringify(out)).toContain('x is undefined')
    expect(JSON.stringify(out)).toContain('12:30:45')
    expect(JSON.stringify(out)).toContain('/assets/index-abc.js')
    expect(out.user).toBeUndefined()
    expect(out.breadcrumbs).toBeUndefined()
  })
})
