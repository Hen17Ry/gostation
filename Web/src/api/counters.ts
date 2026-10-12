/**
 * Compteurs des badges de la barre latérale (dossiers en attente, signalements et alertes
 * ouverts, épingles à vérifier). Module léger : il fait partie de la coquille (JS initial).
 */
import { queryOptions } from '@tanstack/react-query'
import * as z from 'zod/mini'

import { api, type Schemas, unwrap } from './client'
import { counterKeys } from './keys'

export const countersSchema = z.object({
  pendingStations: z.int(),
  openReports: z.int(),
  openAlerts: z.int(),
  locationReviews: z.int(),
}) satisfies z.ZodMiniType<Schemas['AdminCounters']>
export type Counters = z.infer<typeof countersSchema>

export const countersQuery = queryOptions({
  queryKey: counterKeys.all,
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/admin/counters', { signal }), countersSchema),
  staleTime: 30_000,
  // Toutes les 60 s quand l'onglet est visible ; au retour sur l'onglet, rafraîchis aussitôt.
  refetchInterval: 60_000,
})
