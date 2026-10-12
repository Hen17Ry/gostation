import { create } from 'zustand'

import { ApiError, isApiError } from '@/api/errors'
import { searchStations } from '@/api/public'
import type { SearchResponse } from '@/api/schemas'
import type { LatLng } from '@/lib/geo'

/**
 * Recherche en cours et derniers résultats **de cette session** (mémoire seulement : ils
 * dépendent de la position, règle 2). Hors connexion, ils restent affichés avec un avertissement.
 */
export type SearchStatus = 'idle' | 'searching' | 'success' | 'error'

interface SearchState {
  status: SearchStatus
  response: SearchResponse | null
  origin: LatLng | null
  productId: number | null
  error: ApiError | null
  completedAt: number | null
  selectedId: string | null
  run: (origin: LatLng, productId: number) => Promise<SearchResponse | null>
  select: (id: string | null) => void
  reset: () => void
}

/** Durée minimale de l'animation de recherche : évite un flash quand le cache répond en 30 ms. */
export const MIN_SEARCH_MS = 650

let controller: AbortController | null = null

export const useSearch = create<SearchState>((set) => ({
  status: 'idle',
  response: null,
  origin: null,
  productId: null,
  error: null,
  completedAt: null,
  selectedId: null,

  async run(origin, productId) {
    controller?.abort()
    const ctl = new AbortController()
    controller = ctl
    set({ status: 'searching', error: null, selectedId: null })
    const started = Date.now()
    try {
      const [response] = await Promise.all([
        searchStations(origin, productId, ctl.signal),
        new Promise((r) => setTimeout(r, MIN_SEARCH_MS)),
      ])
      if (ctl.signal.aborted) return null
      set({ status: 'success', response, origin, productId, completedAt: Date.now() })
      return response
    } catch (e) {
      if (ctl.signal.aborted) return null
      const error = isApiError(e) ? e : ApiError.network(e)
      const wait = MIN_SEARCH_MS - (Date.now() - started)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      // Les derniers résultats restent (affichage hors connexion) ; l'erreur s'affiche au-dessus.
      set({ status: 'error', error })
      return null
    }
  },

  select: (selectedId) => set({ selectedId }),
  reset: () => {
    controller?.abort()
    set({ status: 'idle', response: null, origin: null, error: null, selectedId: null, completedAt: null })
  },
}))
