import * as z from 'zod/mini'

import type { UserFilters } from '@/api/admin'

export const userSearchSchema = z.object({
  q: z.catch(z.optional(z.string().check(z.maxLength(100))), undefined),
  role: z.catch(z.optional(z.enum(['user', 'manager', 'admin'])), undefined),
  status: z.catch(z.optional(z.enum(['active', 'disabled', 'pending_deletion'])), undefined),
  verified: z.catch(z.optional(z.enum(['yes', 'no'])), undefined),
  cursor: z.catch(z.optional(z.string()), undefined),
  user: z.catch(z.optional(z.string()), undefined),
})
export type UserSearch = z.infer<typeof userSearchSchema>

export function toUserFilters(s: UserSearch): UserFilters {
  const f: UserFilters = {}
  if (s.q) f.q = s.q
  if (s.role) f.role = s.role
  if (s.status) f.status = s.status
  if (s.verified) f.emailVerified = s.verified === 'yes'
  if (s.cursor) f.cursor = s.cursor
  return f
}
