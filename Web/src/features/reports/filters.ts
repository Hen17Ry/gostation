import * as z from 'zod/mini'

import type { ReportFilters } from '@/api/admin'
import { reportReasons } from '@/api/admin-schemas'

export const reportSearchSchema = z.object({
  status: z.catch(z.optional(z.enum(['open', 'resolved', 'dismissed'])), undefined),
  reason: z.catch(z.optional(z.enum(reportReasons)), undefined),
  stationId: z.catch(z.optional(z.string()), undefined),
  cursor: z.catch(z.optional(z.string()), undefined),
  report: z.catch(z.optional(z.string()), undefined),
})
export type ReportSearch = z.infer<typeof reportSearchSchema>

export const toReportFilters = (s: ReportSearch): ReportFilters => {
  const f: ReportFilters = { status: s.status ?? 'open' }
  if (s.reason) f.reason = s.reason
  if (s.stationId) f.stationId = s.stationId
  if (s.cursor) f.cursor = s.cursor
  return f
}
