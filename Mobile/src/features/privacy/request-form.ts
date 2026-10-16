import * as z from 'zod/mini'

import { t } from '@/i18n'

/** Types proposés dans l'app (la copie des données a son propre bouton, immédiat). */
export const REQUEST_TYPES = ['access', 'rectification', 'opposition', 'deletion', 'other'] as const
export type RequestType = (typeof REQUEST_TYPES)[number]

/** Précisions exigées par l'API pour ces types (10 caractères au moins). */
export const DETAILS_REQUIRED: readonly RequestType[] = ['rectification', 'other']

export const requestSchema = z
  .object({
    type: z.enum(REQUEST_TYPES),
    details: z.string().check(z.maxLength(2000, { error: t.privacy.detailsRequired })),
  })
  .check(
    z.refine((v) => !DETAILS_REQUIRED.includes(v.type) || v.details.trim().length >= 10, {
      error: t.privacy.detailsRequired,
      path: ['details'],
    }),
  )
export type RequestValues = z.infer<typeof requestSchema>
