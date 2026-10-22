import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { Versioned } from '@/api/manager'
import type { Stock, StockList } from '@/api/schemas'
import { storage } from '@/lib/storage'

/**
 * Brouillon de la saisie des stocks (D59, D60) : dernier état connu des stocks de la station
 * (`base`, avec sa version) et quantités modifiées par le gérant (`values`). Conservé dans MMKV,
 * même si l'app est fermée : aucune donnée personnelle, seulement des quantités. Jamais envoyé tout
 * seul : l'envoi garde l'`If-Match` de la version saisie (une donnée plus récente n'est pas écrasée).
 */
export interface StockSnapshot {
  etag: string
  items: Stock[]
  /** Heure de la lecture (affichage « derniers stocks connus » hors connexion). */
  fetchedAt: number
}

export interface StockChange {
  productId: number
  label: string
  unit: Stock['unit']
  from: number
  to: number
}

export interface StockConflict {
  productId: number
  label: string
  unit: Stock['unit']
  before: number
  now: number
  yours: number
}

interface DraftState {
  stationId: string | null
  base: StockSnapshot | null
  values: Record<number, number>
  /** Nouvelle lecture de l'API : remplace la base s'il n'y a pas de saisie en cours. */
  sync: (stationId: string, server: Versioned<StockList>) => void
  setQuantity: (productId: number, quantity: number) => void
  /** Envoi réussi (saisie ou confirmation) : la réponse devient la base, la saisie est vidée. */
  committed: (server: Versioned<StockList>) => void
  /** Conflit (412) : nouvelle base, saisie gardée pour les produits encore vendus. */
  rebase: (server: Versioned<StockList>) => void
  discard: () => void
  clear: () => void
}

const snapshot = (server: Versioned<StockList>): StockSnapshot => ({
  etag: server.etag,
  items: server.data.items,
  fetchedAt: Date.now(),
})

export const useStockDraft = create<DraftState>()(
  persist(
    (set, get) => ({
      stationId: null,
      base: null,
      values: {},
      sync: (stationId, server) => {
        const { stationId: current, values } = get()
        if (current !== stationId) {
          set({ stationId, base: snapshot(server), values: {} })
          return
        }
        if (Object.keys(values).length === 0) set({ base: snapshot(server) })
      },
      setQuantity: (productId, quantity) => {
        const base = get().base
        const item = base?.items.find((i) => i.productId === productId)
        if (!item) return
        const q = Math.max(0, Math.min(item.maxQuantity, Math.round(quantity)))
        const values = { ...get().values }
        if (q === item.quantity) delete values[productId]
        else values[productId] = q
        set({ values })
      },
      committed: (server) => set({ base: snapshot(server), values: {} }),
      rebase: (server) => {
        const sold = new Set(server.data.items.map((i) => i.productId))
        const values = Object.fromEntries(Object.entries(get().values).filter(([id]) => sold.has(Number(id))))
        set({ base: snapshot(server), values })
      },
      discard: () => set({ values: {} }),
      clear: () => set({ stationId: null, base: null, values: {} }),
    }),
    {
      name: 'stock-draft',
      storage: createJSONStorage(() => ({
        getItem: (k) => storage.getString(k) ?? null,
        setItem: (k, v) => storage.set(k, v),
        removeItem: (k) => void storage.remove(k),
      })),
      partialize: ({ stationId, base, values }) => ({ stationId, base, values }),
    },
  ),
)

/** Quantité affichée d'un produit : la saisie, sinon la base. */
export const quantityOf = (item: Stock, values: Record<number, number>) => values[item.productId] ?? item.quantity

/** Changements à envoyer, dans l'ordre des produits. */
export function stockChanges(base: StockSnapshot | null, values: Record<number, number>): StockChange[] {
  if (!base) return []
  return base.items
    .filter((i) => values[i.productId] !== undefined && values[i.productId] !== i.quantity)
    .map((i) => ({ productId: i.productId, label: i.label, unit: i.unit, from: i.quantity, to: values[i.productId]! }))
}

/** Corps du `PUT` : un élément par produit vendu, ni plus ni moins (D16). */
export const stockPayload = (base: StockSnapshot, values: Record<number, number>) =>
  base.items.map((i) => ({ productId: i.productId, quantity: quantityOf(i, values) }))

/**
 * Ce qui a changé côté serveur depuis la base de la saisie (412) : quantités différentes, produits
 * ajoutés ou retirés. Vide si la version a changé pour une autre raison (horaires, profil…).
 */
export function stockConflicts(
  base: StockSnapshot,
  server: StockList,
  values: Record<number, number>,
): StockConflict[] {
  const before = new Map(base.items.map((i) => [i.productId, i]))
  const out: StockConflict[] = []
  for (const now of server.items) {
    const old = before.get(now.productId)
    if (old && old.quantity === now.quantity) continue
    out.push({
      productId: now.productId,
      label: now.label,
      unit: now.unit,
      before: old?.quantity ?? 0,
      now: now.quantity,
      yours: values[now.productId] ?? old?.quantity ?? now.quantity,
    })
  }
  return out
}

/** Rappel dans l'app au-delà de 4 h sans mise à jour ni confirmation (même délai que le rappel push). */
export const STOCK_REMINDER_AFTER_MS = 4 * 3600_000

/** Dernière mise à jour ou confirmation des stocks : la plus récente des produits (`freshAt`). */
export function lastStockActivity(items: Stock[]): string | null {
  let last: string | null = null
  for (const i of items) if (last === null || Date.parse(i.freshAt) > Date.parse(last)) last = i.freshAt
  return last
}

/**
 * Rappel visible sans push (téléphone sans services Google, notifications coupées) : produits
 * déclarés et stocks plus vieux que 4 h.
 */
export function stockReminderDue(items: Stock[], now: number): boolean {
  const last = lastStockActivity(items)
  return last !== null && now - Date.parse(last) > STOCK_REMINDER_AFTER_MS
}
