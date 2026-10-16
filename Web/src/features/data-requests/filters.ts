import * as z from 'zod/mini'

import type { DataRequestFilters } from '@/api/admin'
import { dataRequestTypes } from '@/api/admin-schemas'

export const dataRequestSearchSchema = z.object({
  status: z.catch(z.optional(z.enum(['open', 'completed', 'rejected', 'all'])), undefined),
  type: z.catch(z.optional(z.enum(dataRequestTypes)), undefined),
  overdue: z.catch(z.optional(z.boolean()), undefined),
  cursor: z.catch(z.optional(z.string()), undefined),
  request: z.catch(z.optional(z.string()), undefined),
})
export type DataRequestSearch = z.infer<typeof dataRequestSearchSchema>

export const toDataRequestFilters = (s: DataRequestSearch): DataRequestFilters => {
  const f: DataRequestFilters = { status: s.status ?? 'open' }
  if (s.type) f.type = s.type
  if (s.overdue) f.overdue = true
  if (s.cursor) f.cursor = s.cursor
  return f
}
