import { queryOptions } from '@tanstack/react-query'

import type { LatLng } from '@/lib/geo'

import { api, unwrap } from './client'
import { productKeys, stationKeys } from './keys'
import { productListSchema, publicStationSchema, routeSchema, searchResponseSchema } from './schemas'

/** Catalogue des produits actifs (rare à changer : 24 h, persisté pour l'usage hors ligne). */
export const productsQuery = queryOptions({
  queryKey: productKeys.all,
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/products', { signal }), productListSchema),
  select: (d) => d.items,
  staleTime: 24 * 3600_000,
  gcTime: 7 * 24 * 3600_000,
})

/** Fiche publique (stocks, horaires) : fraîche 30 s, persistée pour le hors-ligne. */
export const stationQuery = (id: string) =>
  queryOptions({
    queryKey: stationKeys.detail(id),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/stations/{id}', { params: { path: { id } }, signal }), publicStationSchema),
    staleTime: 30_000,
    gcTime: 24 * 3600_000,
  })

/**
 * Recherche depuis une position (jamais mise en cache par TanStack Query : appel direct, résultat
 * gardé en mémoire dans le store de recherche, cf. règle 2).
 */
export function searchStations(position: LatLng, productId: number, signal?: AbortSignal) {
  return unwrap(
    api.GET('/api/v1/search', {
      params: { query: { lat: position.lat, lng: position.lng, product_id: productId } },
      signal,
    }),
    searchResponseSchema,
  )
}

/** Itinéraire OSRM (étapes structurées, texte composé sur l'appareil). */
export function fetchRoute(position: LatLng, stationId: string, signal?: AbortSignal) {
  return unwrap(
    api.GET('/api/v1/routes', {
      params: { query: { lat: position.lat, lng: position.lng, station_id: stationId } },
      signal,
    }),
    routeSchema,
  )
}
