import * as z from 'zod/mini'

import type { AuditFilters } from '@/api/admin'

const day = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))

export const auditSearchSchema = z.object({
  actorId: z.catch(z.optional(z.string()), undefined),
  action: z.catch(z.optional(z.string().check(z.maxLength(65))), undefined),
  entityType: z.catch(z.optional(z.string().check(z.maxLength(32))), undefined),
  entityId: z.catch(z.optional(z.string().check(z.maxLength(64))), undefined),
  from: z.catch(z.optional(day), undefined),
  to: z.catch(z.optional(day), undefined),
  cursor: z.catch(z.optional(z.string()), undefined),
  entry: z.catch(z.optional(z.string()), undefined),
})
export type AuditSearch = z.infer<typeof auditSearchSchema>

export function toAuditFilters(s: AuditSearch): AuditFilters {
  const { cursor, entry: _e, ...rest } = s
  const f: AuditFilters = {}
  for (const [k, v] of Object.entries(rest)) if (v) (f as Record<string, string>)[k] = v
  if (cursor) f.cursor = cursor
  return f
}
