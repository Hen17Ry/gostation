/**
 * Règle 2 côté app : la position de l'utilisateur n'est jamais persistée (ni MMKV, ni cache de
 * requêtes, ni préférences). Seules les données publiques (catalogue, fiches) vont dans MMKV.
 */
import { QueryClient } from '@tanstack/react-query'

import { productKeys, routeKeys, searchKeys, stationKeys, meKeys } from '@/api/keys'
import { useLocation } from '@/features/location/location-store'
import { useSearch } from '@/features/search/search-store'
import { persistOptions } from '@/lib/query-client'
import { storage } from '@/lib/storage'
import { usePrefs } from '@/stores/prefs'

const HERE = { lat: 6.365412, lng: 2.418301 }

const searchResponse = {
  product: { id: 2, code: 'lpg_12_5', label: 'Gaz 12,5 kg', unit: 'cylinder' },
  strategy: 'radius',
  radiusM: 2000,
  routingApproximate: false,
  results: [],
  generatedAt: '2026-10-12T19:00:00Z',
}

describe('confidentialité de la position', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('ne persiste que les requêtes publiques', () => {
    const should = persistOptions.dehydrateOptions.shouldDehydrateQuery
    const q = (key: readonly unknown[]) => ({ queryKey: key, state: { status: 'success' } })
    expect(should(q(productKeys.all))).toBe(true)
    expect(should(q(stationKeys.detail('s1')))).toBe(true)
    expect(should(q([...searchKeys.all, HERE.lat, HERE.lng]))).toBe(false)
    expect(should(q(routeKeys.all))).toBe(false)
    expect(should(q(meKeys.profile()))).toBe(false)
  })

  it('après recherche, choix manuel et préférences, MMKV ne contient aucune coordonnée', async () => {
    globalThis.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(searchResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as typeof fetch
    useLocation.getState().setDevice(HERE, 8)
    useLocation.getState().setManual({ lat: 6.4, lng: 2.35 })
    usePrefs.getState().setProductId(2)
    usePrefs.getState().setVoice(true)

    const res = await useSearch.getState().run(HERE, 2)
    expect(res?.strategy).toBe('radius')

    // Une sérialisation du cache de requêtes ne garderait rien de la recherche.
    const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
    qc.setQueryData([...searchKeys.all], searchResponse)
    const persisted = JSON.stringify(
      qc
        .getQueryCache()
        .getAll()
        .filter((query) => persistOptions.dehydrateOptions.shouldDehydrateQuery(query)),
    )
    expect(persisted).toBe('[]')
    qc.clear()

    const dump = storage
      .getAllKeys()
      .map((k) => `${k}=${storage.getString(k) ?? ''}`)
      .join('\n')
    expect(dump).not.toMatch(/6\.36|2\.41|6\.4\b|2\.35/)
    expect(dump).not.toMatch(/"lat"|"lng"/)
  })
})
