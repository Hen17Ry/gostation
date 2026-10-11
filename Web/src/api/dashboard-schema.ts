/**
 * Validation zod de GET /admin/dashboard, chargée avec la première requête du tableau de bord
 * (hors du JS initial de l'écran de connexion). Vérifiée contre le type généré (`satisfies`).
 */
import * as z from 'zod/mini'

import type { Schemas } from './client'
import { isoDate } from './schemas'

const kpiSchema = z.object({ value: z.number(), previous: z.number(), change: z.nullable(z.number()) })
export type Kpi = z.infer<typeof kpiSchema>

const productRefSchema = z.object({ id: z.int(), code: z.string(), label: z.string() })
const counts = z.record(z.string(), z.int())

export const dashboardSchema = z.object({
  period: z.object({
    key: z.enum(['24h', '7d', '30d', 'custom']),
    from: isoDate,
    to: isoDate,
    previousFrom: isoDate,
    previousTo: isoDate,
    granularity: z.enum(['hour', 'day']),
    timezone: z.string(),
  }),
  stations: z.object({
    byStatus: counts,
    pendingApplications: z.object({
      count: z.int(),
      oldestSince: z.nullable(isoDate),
      oldestAgeS: z.nullable(z.int()),
    }),
  }),
  stockFreshness: z.object({
    fresh: z.int(),
    stale: z.int(),
    expired: z.int(),
    total: z.int(),
    freshShare: z.number(),
    staleShare: z.number(),
    expiredShare: z.number(),
  }),
  inactiveManagers: z.int(),
  searches: z.object({
    total: kpiSchema,
    byProduct: z.array(z.extend(kpiSchema, { product: productRefSchema })),
    emptyRate: kpiSchema,
  }),
  shortages: z.object({
    zones: z.int(),
    top: z.array(
      z.object({
        cell: z.string(),
        center: z.object({ lat: z.number(), lng: z.number() }),
        searches: z.int(),
        emptySearches: z.int(),
        emptyRate: z.number(),
      }),
    ),
    k: z.int(),
    threshold: z.number(),
  }),
  reports: z.object({ open: z.int(), created: kpiSchema }),
  alerts: z.object({ open: z.int(), byKind: counts }),
  registrations: z.object({ users: kpiSchema, managers: kpiSchema }),
  series: z.object({
    searches: z.array(
      z.object({
        at: isoDate,
        searches: z.int(),
        emptySearches: z.int(),
        byProduct: counts,
      }),
    ),
    freshness: z.array(
      z.object({
        at: isoDate,
        fresh: z.nullable(z.number()),
        stale: z.nullable(z.number()),
        expired: z.nullable(z.number()),
      }),
    ),
  }),
}) satisfies z.ZodMiniType<Schemas['Dashboard']>
export type Dashboard = z.infer<typeof dashboardSchema>
