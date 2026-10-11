import * as z from 'zod/mini'

import { toLocalDate } from '@/lib/format'

export const PERIODS = ['24h', '7d', '30d', 'custom'] as const
export type PeriodKey = (typeof PERIODS)[number]
export const MAX_RANGE_DAYS = 366

const localDate = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))

/** Paramètres d'URL du tableau de bord (lien profond : ?period=custom&from=…&to=…). */
export const periodSearchSchema = z.object({
  period: z.catch(z.optional(z.enum(PERIODS)), undefined),
  from: z.catch(z.optional(localDate), undefined),
  to: z.catch(z.optional(localDate), undefined),
})
export type PeriodSearchInput = z.infer<typeof periodSearchSchema>

export interface PeriodSearch {
  period: PeriodKey
  from?: string
  to?: string
}

const DAY_MS = 86_400_000
const dayIndex = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY_MS

/** Plage valide : from ≤ to ≤ aujourd'hui (heure de Porto-Novo), 366 jours au plus. */
export function isValidRange(from: string, to: string, today = toLocalDate(new Date())): boolean {
  const days = dayIndex(to) - dayIndex(from) + 1
  return days >= 1 && days <= MAX_RANGE_DAYS && to <= today
}

/** Période effective : 7 j par défaut ; une plage incomplète ou invalide retombe sur 7 j. */
export function normalizePeriod(input: PeriodSearchInput): PeriodSearch {
  const period = input.period ?? '7d'
  if (period !== 'custom') return { period }
  if (input.from && input.to && isValidRange(input.from, input.to)) return { period, from: input.from, to: input.to }
  return { period: '7d' }
}

/** Paramètres de requête de l'API (`from`/`to` seulement pour une plage). */
export function toApiQuery(p: PeriodSearch) {
  return p.period === 'custom' ? { period: p.period, from: p.from, to: p.to } : { period: p.period }
}

const BUCKET_MS = { hour: 3_600_000, day: 86_400_000 } as const

/** Tranche encore en cours (la période court jusqu'à maintenant) : ses valeurs sont partielles. */
export function isPartialBucket(at: string, granularity: 'hour' | 'day', periodTo: string): boolean {
  return Date.parse(at) + BUCKET_MS[granularity] > Date.parse(periodTo)
}
