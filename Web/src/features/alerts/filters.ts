import * as z from 'zod/mini'

import type { AlertFilters } from '@/api/admin'

export const alertSearchSchema = z.object({
  status: z.catch(z.optional(z.enum(['open', 'resolved', 'all'])), undefined),
  kind: z.catch(z.optional(z.enum(['manager_inactive', 'reports_threshold', 'location'])), undefined),
  cursor: z.catch(z.optional(z.string()), undefined),
})
export type AlertSearch = z.infer<typeof alertSearchSchema>

/** Filtres de l'API des alertes ; null pour le type « épingle à vérifier » (liste de stations). */
export function toAlertFilters(s: AlertSearch): AlertFilters | null {
  if (s.kind === 'location') return null
  const f: AlertFilters = { status: s.status ?? 'open' }
  if (s.kind) f.kind = s.kind
  if (s.cursor) f.cursor = s.cursor
  return f
}
