import type { Versioned } from '@/api/manager'
import type { Stock, StockList } from '@/api/schemas'

import {
  lastStockActivity,
  stockChanges,
  stockConflicts,
  stockPayload,
  stockReminderDue,
  useStockDraft,
} from './stock-draft'

const stock = (productId: number, quantity: number, over: Partial<Stock> = {}): Stock => ({
  productId,
  code: `p${productId}`,
  label: `Produit ${productId}`,
  unit: 'cylinder',
  sizeKg: 12.5,
  quantity,
  maxQuantity: 10_000,
  updatedAt: '2026-10-13T08:00:00Z',
  lastConfirmedAt: '2026-10-13T08:00:00Z',
  freshAt: '2026-10-13T08:00:00Z',
  freshness: 'fresh',
  ...over,
})
const list = (etag: string, ...items: Stock[]): Versioned<StockList> => ({
  etag,
  data: { lastActivityAt: '2026-10-13T08:00:00Z', items },
})

describe('brouillon des stocks', () => {
  beforeEach(() => useStockDraft.getState().clear())

  it('remplace la base à chaque lecture tant que rien n’est saisi, la garde ensuite', () => {
    const d = useStockDraft.getState()
    d.sync('s1', list('"v1"', stock(1, 10), stock(2, 3)))
    d.sync('s1', list('"v2"', stock(1, 11), stock(2, 3)))
    expect(useStockDraft.getState().base?.etag).toBe('"v2"')
    useStockDraft.getState().setQuantity(1, 15)
    useStockDraft.getState().sync('s1', list('"v3"', stock(1, 12), stock(2, 3)))
    // La saisie part avec la version sur laquelle elle a été faite (412 si une autre est plus récente).
    expect(useStockDraft.getState().base?.etag).toBe('"v2"')
    expect(useStockDraft.getState().values).toEqual({ 1: 15 })
  })

  it('repart de zéro pour une autre station', () => {
    useStockDraft.getState().sync('s1', list('"v1"', stock(1, 10)))
    useStockDraft.getState().setQuantity(1, 4)
    useStockDraft.getState().sync('s2', list('"v9"', stock(7, 1)))
    expect(useStockDraft.getState()).toMatchObject({ stationId: 's2', values: {} })
  })

  it('borne la saisie entre 0 et le plafond et oublie un retour à la valeur envoyée', () => {
    useStockDraft.getState().sync('s1', list('"v1"', stock(1, 10, { maxQuantity: 50 })))
    useStockDraft.getState().setQuantity(1, 80)
    expect(useStockDraft.getState().values).toEqual({ 1: 50 })
    useStockDraft.getState().setQuantity(1, -3)
    expect(useStockDraft.getState().values).toEqual({ 1: 0 })
    useStockDraft.getState().setQuantity(1, 10)
    expect(useStockDraft.getState().values).toEqual({})
  })

  it('liste les changements et envoie un élément par produit vendu', () => {
    useStockDraft.getState().sync('s1', list('"v1"', stock(1, 10), stock(2, 3), stock(3, 0)))
    useStockDraft.getState().setQuantity(2, 0)
    const { base, values } = useStockDraft.getState()
    expect(stockChanges(base, values)).toEqual([{ productId: 2, label: 'Produit 2', unit: 'cylinder', from: 3, to: 0 }])
    expect(stockPayload(base!, values)).toEqual([
      { productId: 1, quantity: 10 },
      { productId: 2, quantity: 0 },
      { productId: 3, quantity: 0 },
    ])
  })

  it('montre ce qui a changé entre-temps, et rien si seule la version a bougé', () => {
    useStockDraft.getState().sync('s1', list('"v1"', stock(1, 10), stock(2, 3)))
    useStockDraft.getState().setQuantity(1, 20)
    const { base, values } = useStockDraft.getState()
    expect(stockConflicts(base!, list('"v2"', stock(1, 10), stock(2, 3)).data, values)).toEqual([])
    expect(stockConflicts(base!, list('"v2"', stock(1, 14), stock(2, 3)).data, values)).toEqual([
      { productId: 1, label: 'Produit 1', unit: 'cylinder', before: 10, now: 14, yours: 20 },
    ])
  })

  it('au rechargement après un conflit, garde la saisie des produits encore vendus', () => {
    useStockDraft.getState().sync('s1', list('"v1"', stock(1, 10), stock(2, 3)))
    useStockDraft.getState().setQuantity(1, 20)
    useStockDraft.getState().setQuantity(2, 1)
    useStockDraft.getState().rebase(list('"v2"', stock(1, 14)))
    expect(useStockDraft.getState()).toMatchObject({ values: { 1: 20 } })
    expect(useStockDraft.getState().base?.etag).toBe('"v2"')
    useStockDraft.getState().committed(list('"v3"', stock(1, 20)))
    expect(useStockDraft.getState().values).toEqual({})
  })
})

describe('rappel dans l’app (sans push)', () => {
  const at = (iso: string) => Date.parse(iso)

  it('dernière activité : la mise à jour ou confirmation la plus récente des produits', () => {
    const items = [stock(1, 3, { freshAt: '2026-10-13T08:00:00Z' }), stock(2, 0, { freshAt: '2026-10-13T09:30:00Z' })]
    expect(lastStockActivity(items)).toBe('2026-10-13T09:30:00Z')
    expect(lastStockActivity([])).toBeNull()
  })

  it('au-delà de 4 h sans mise à jour ni confirmation, pas avant', () => {
    const items = [stock(1, 3, { freshAt: '2026-10-13T08:00:00Z' })]
    expect(stockReminderDue(items, at('2026-10-13T12:00:00Z'))).toBe(false)
    expect(stockReminderDue(items, at('2026-10-13T12:01:00Z'))).toBe(true)
  })

  it('aucun produit déclaré : pas de rappel (la configuration le demande déjà)', () => {
    expect(stockReminderDue([], at('2026-10-14T12:00:00Z'))).toBe(false)
  })
})
