import { searchOrigin } from '@/features/location/location-store'

import { useSearch } from './search-store'

const response = {
  product: { id: 2, code: 'lpg_10kg', label: 'Gaz 10 kg', unit: 'cylinder' },
  strategy: 'radius',
  radiusM: 500,
  routingApproximate: false,
  results: [],
  generatedAt: '2026-10-13T08:00:00Z',
}
const ok = () =>
  new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('useSearch', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    useSearch.getState().reset()
  })

  it('garde les derniers résultats de la session quand le réseau tombe (affichage hors connexion)', async () => {
    globalThis.fetch = jest.fn(async () => ok()) as typeof fetch
    await useSearch.getState().run({ lat: 6.36, lng: 2.41 }, 2)
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed')
    }) as typeof fetch
    expect(await useSearch.getState().run({ lat: 6.36, lng: 2.41 }, 2)).toBeNull()
    const s = useSearch.getState()
    expect(s.status).toBe('error')
    expect(s.error?.code).toBe('network.error')
    expect(s.response?.strategy).toBe('radius')
  })

  it('remplace la recherche précédente si une nouvelle est lancée', async () => {
    globalThis.fetch = jest.fn(async () => ok()) as typeof fetch
    const first = useSearch.getState().run({ lat: 6.36, lng: 2.41 }, 2)
    const second = useSearch.getState().run({ lat: 6.37, lng: 2.42 }, 2)
    expect(await first).toBeNull()
    expect((await second)?.strategy).toBe('radius')
  })
})

describe('searchOrigin', () => {
  const device = { lat: 6.36, lng: 2.41 }
  const manual = { lat: 6.4, lng: 2.35 }
  it('suit le mode choisi', () => {
    expect(searchOrigin({ mode: 'device', device, manual })).toEqual(device)
    expect(searchOrigin({ mode: 'manual', device, manual })).toEqual(manual)
    expect(searchOrigin({ mode: 'device', device: null, manual })).toEqual(manual)
    expect(searchOrigin({ mode: 'manual', device, manual: null })).toBeNull()
  })
})
