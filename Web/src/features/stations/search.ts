import * as z from 'zod/mini'

import type { StationFilters } from '@/api/admin'

const flag = z.catch(z.optional(z.boolean()), undefined)

/** Filtres de la liste des stations, dans l'URL (lien profond, retour arrière). */
export const stationSearchSchema = z.object({
  status: z.catch(z.optional(z.enum(['pending', 'approved', 'rejected', 'suspended', 'all'])), undefined),
  q: z.catch(z.optional(z.string().check(z.maxLength(100))), undefined),
  freshness: z.catch(z.optional(z.enum(['stale', 'expired'])), undefined),
  needsReview: flag,
  reported: flag,
  excluded: flag,
  managerInactive: flag,
  noHours: flag,
  cursor: z.catch(z.optional(z.string()), undefined),
})
export type StationSearch = z.infer<typeof stationSearchSchema>

export const STATION_FLAGS = ['needsReview', 'reported', 'excluded', 'managerInactive', 'noHours'] as const

/** Filtres de l'API : en attente par défaut, booléens envoyés seulement s'ils sont actifs. */
export function toStationFilters(s: StationSearch): StationFilters {
  const f: StationFilters = { status: s.status ?? 'pending' }
  if (s.q) f.q = s.q
  if (s.freshness) f.freshness = s.freshness
  for (const k of STATION_FLAGS) if (s[k]) f[k] = true
  if (s.cursor) f.cursor = s.cursor
  return f
}

/** Nombre de filtres actifs en plus du statut (bouton « Réinitialiser »). */
export const activeStationFilters = (s: StationSearch) =>
  (s.q ? 1 : 0) + (s.freshness ? 1 : 0) + STATION_FLAGS.filter((k) => s[k]).length
