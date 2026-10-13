import { act, renderHook } from '@testing-library/react-native'

import type { SearchResult } from '@/api/schemas'

import { useStagedCount } from './results-list'

const result = (i: number): SearchResult => ({
  station: { id: `st-${i}`, name: `Station ${i}`, brand: null, location: { lat: 6.37, lng: 2.44 } },
  distanceM: 500 * i,
  routeDistanceM: 600 * i,
  durationS: 60 * i,
  quantity: 10,
  stale: false,
  stockUpdatedAt: '2026-10-12T18:00:00Z',
  updatedAgoS: 600,
  isOpen: true,
  nextOpening: null,
  servedAt: null,
  reported: false,
})
const list = (n: number) => Array.from({ length: n }, (_, i) => result(i + 1))

describe('useStagedCount', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('monte deux cartes avec les résultats, puis les autres une par image après les animations', async () => {
    const items = list(10)
    const { result: r } = await renderHook(() => useStagedCount(items))
    expect(r.current.count).toBe(2)
    await act(() => jest.advanceTimersByTime(600))
    expect(r.current.count).toBe(2)
    // Une carte de plus à chaque image, jamais deux d'un coup.
    const seen = [r.current.count]
    while (r.current.count < 10 && seen.length < 50) {
      await act(() => jest.advanceTimersToNextTimer())
      if (r.current.count !== seen.at(-1)) seen.push(r.current.count)
    }
    expect(seen).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('repart de deux cartes dès le premier rendu d’une nouvelle recherche', async () => {
    const { result: r, rerender } = await renderHook(({ items }: { items: SearchResult[] }) => useStagedCount(items), {
      initialProps: { items: list(10) },
    })
    await act(() => jest.advanceTimersByTime(2000))
    expect(r.current.count).toBe(10)
    await rerender({ items: list(8) })
    expect(r.current.count).toBe(2)
  })

  it('montre tout d’un coup pour atteindre une carte pas encore montée', async () => {
    const { result: r } = await renderHook(({ items }: { items: SearchResult[] }) => useStagedCount(items), {
      initialProps: { items: list(6) },
    })
    await act(() => r.current.revealAll())
    expect(r.current.count).toBe(6)
  })

  it('montre d’emblée une liste qui tient dans le premier lot', async () => {
    const { result: r } = await renderHook(({ items }: { items: SearchResult[] }) => useStagedCount(items), {
      initialProps: { items: list(1) },
    })
    expect(r.current.count).toBe(1)
    await act(() => jest.runOnlyPendingTimers())
    expect(r.current.count).toBe(1)
  })
})
