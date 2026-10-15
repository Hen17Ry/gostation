/**
 * Schémas zod/mini des ressources admin (stations, signalements, alertes, comptes, catalogue,
 * audit, exports, cartes). Chacun est vérifié à la compilation contre le type généré depuis
 * openapi.yaml (`satisfies`). Importé seulement par les écrans qui en ont besoin : hors du JS
 * initial.
 */
import * as z from 'zod/mini'

import type { Schemas } from './client'
import { isoDate } from './schemas'

const nullableString = z.nullable(z.string())
const nullableDate = z.nullable(isoDate)
const latLng = z.object({ lat: z.number(), lng: z.number() })

export const stationStatuses = ['pending', 'approved', 'rejected', 'suspended'] as const
export type StationStatus = (typeof stationStatuses)[number]
const stationStatus = z.enum(stationStatuses)
export const freshnessValues = ['fresh', 'stale', 'expired', 'none'] as const
export type StationFreshness = (typeof freshnessValues)[number]
const freshness = z.enum(freshnessValues)
export const reportReasons = ['out_of_stock', 'station_closed', 'wrong_location', 'other'] as const
export type ReportReason = (typeof reportReasons)[number]
const reportReason = z.enum(reportReasons)
const productRef = z.object({ id: z.int(), label: z.string() })
const stationRef = z.object({ id: z.string(), name: z.string() })
const page = <T extends z.ZodMiniType>(item: T) => z.object({ items: z.array(item), nextCursor: nullableString })

// ── Stations ────────────────────────────────────────────────────────────────

export const stationSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: nullableString,
  ifu: z.string(),
  city: nullableString,
  status: stationStatus,
  version: z.int(),
  location: z.nullable(latLng),
  managerEmailVerified: z.boolean(),
  locationFlagged: z.boolean(),
  hasPendingMove: z.boolean(),
  hasOpeningHours: z.boolean(),
  lastStockUpdateAt: nullableDate,
  freshness,
  reported: z.boolean(),
  excluded: z.boolean(),
  managerInactive: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
}) satisfies z.ZodMiniType<Schemas['AdminStationSummary']>
export type StationSummary = z.infer<typeof stationSummarySchema>
export const stationPageSchema = page(stationSummarySchema) satisfies z.ZodMiniType<Schemas['AdminStationPage']>
export type StationPage = z.infer<typeof stationPageSchema>

const openingHoursSchema = z.object({
  timezone: z.string(),
  isOpenNow: z.boolean(),
  nextOpening: nullableDate,
  days: z.array(
    z.object({
      weekday: z.int(),
      is24h: z.boolean(),
      ranges: z.array(z.object({ opens: z.string(), closes: z.string() })),
    }),
  ),
  closures: z.array(z.object({ id: z.string(), date: z.string(), reason: nullableString, createdAt: isoDate })),
}) satisfies z.ZodMiniType<Schemas['OpeningHours']>
export type OpeningHours = z.infer<typeof openingHoursSchema>

const stockSchema = z.object({
  productId: z.int(),
  code: z.string(),
  label: z.string(),
  unit: z.enum(['cylinder', 'liter']),
  sizeKg: z.nullable(z.number()),
  quantity: z.int(),
  maxQuantity: z.int(),
  updatedAt: isoDate,
  lastConfirmedAt: isoDate,
  freshAt: isoDate,
  freshness: z.enum(['fresh', 'stale', 'expired']),
}) satisfies z.ZodMiniType<Schemas['Stock']>
export type Stock = z.infer<typeof stockSchema>

export const moveRequestSchema = z.object({
  id: z.string(),
  location: latLng,
  distanceM: z.int(),
  deviceDistanceM: z.nullable(z.int()),
  deviceAccuracyM: z.nullable(z.int()),
  createdAt: isoDate,
}) satisfies z.ZodMiniType<Schemas['MoveRequest']>
export type MoveRequest = z.infer<typeof moveRequestSchema>

export const stationSchema = z.object({
  id: z.string(),
  status: stationStatus,
  statusReason: nullableString,
  reviewedAt: nullableDate,
  version: z.int(),
  name: z.string(),
  brand: nullableString,
  ifu: z.string(),
  ifuSharedCount: z.int().check(z.nonnegative()),
  rccm: z.string(),
  address: z.string(),
  city: nullableString,
  phone: z.string(),
  location: z.nullable(latLng),
  locationSetAt: nullableDate,
  locationFlag: z.nullable(z.object({ distanceM: z.int(), accuracyM: z.nullable(z.int()), flaggedAt: isoDate })),
  pendingMove: z.nullable(moveRequestSchema),
  documentMime: nullableString,
  manager: z.nullable(
    z.object({
      id: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      emailVerified: z.boolean(),
    }),
  ),
  lastStockUpdateAt: nullableDate,
  statusChangedAt: isoDate,
  createdAt: isoDate,
  updatedAt: isoDate,
  openingHours: openingHoursSchema,
  stocks: z.array(stockSchema),
}) satisfies z.ZodMiniType<Schemas['AdminStation']>
export type Station = z.infer<typeof stationSchema>

export const stationMapSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      id: z.string(),
      geometry: z.object({ type: z.literal('Point'), coordinates: z.array(z.number()) }),
      properties: z.object({ name: z.string(), status: stationStatus, freshness, reported: z.boolean() }),
    }),
  ),
}) satisfies z.ZodMiniType<Schemas['StationMap']>
export type StationMap = z.infer<typeof stationMapSchema>

// ── Signalements et alertes ─────────────────────────────────────────────────

export const reportSchema = z.object({
  id: z.string(),
  station: stationRef,
  reason: reportReason,
  product: z.nullable(productRef),
  comment: nullableString,
  status: z.enum(['open', 'resolved', 'dismissed']),
  abusive: z.boolean(),
  resolutionNote: nullableString,
  resolvedAt: nullableDate,
  createdAt: isoDate,
  reporter: z.nullable(
    z.object({
      id: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      abusiveReports: z.int(),
      reportingBanned: z.boolean(),
    }),
  ),
}) satisfies z.ZodMiniType<Schemas['AdminReport']>
export type Report = z.infer<typeof reportSchema>
export const reportPageSchema = page(reportSchema) satisfies z.ZodMiniType<Schemas['AdminReportPage']>

export const alertSchema = z.object({
  id: z.string(),
  kind: z.enum(['manager_inactive', 'reports_threshold']),
  station: stationRef,
  reason: z.nullable(reportReason),
  product: z.nullable(productRef),
  details: z.record(z.string(), z.unknown()),
  createdAt: isoDate,
  resolvedAt: nullableDate,
  resolvedBy: nullableString,
  resolution: nullableString,
}) satisfies z.ZodMiniType<Schemas['AdminAlert']>
export type Alert = z.infer<typeof alertSchema>
export const alertPageSchema = page(alertSchema) satisfies z.ZodMiniType<Schemas['AdminAlertPage']>

// ── Comptes ─────────────────────────────────────────────────────────────────

const role = z.enum(['user', 'manager', 'admin'])
const accountStatus = z.enum(['active', 'disabled', 'pending_deletion'])

export const userSummarySchema = z.object({
  id: z.string(),
  role,
  status: accountStatus,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  emailVerified: z.boolean(),
  reportingBanned: z.boolean(),
  lastLoginAt: nullableDate,
  disabledAt: nullableDate,
  createdAt: isoDate,
}) satisfies z.ZodMiniType<Schemas['AdminUserSummary']>
export type UserSummary = z.infer<typeof userSummarySchema>
export const userPageSchema = page(userSummarySchema) satisfies z.ZodMiniType<Schemas['AdminUserPage']>

export const userSchema = z.object({
  id: z.string(),
  role,
  status: accountStatus,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  emailVerified: z.boolean(),
  emailVerifiedAt: nullableDate,
  privacyPolicyVersion: z.string(),
  privacyAcceptedAt: isoDate,
  twoFactorEnabled: z.boolean(),
  lastLoginAt: nullableDate,
  passwordChangedAt: nullableDate,
  disabledAt: nullableDate,
  disabledReason: nullableString,
  reportingBannedAt: nullableDate,
  reportingBanReason: nullableString,
  deletionRequestedAt: nullableDate,
  activeSessions: z.int(),
  devices: z.int(),
  reports: z.object({ total: z.int(), abusive: z.int() }),
  favorites: z.int(),
  station: z.nullable(z.object({ id: z.string(), name: z.string(), status: stationStatus })),
  createdAt: isoDate,
  updatedAt: isoDate,
}) satisfies z.ZodMiniType<Schemas['AdminUser']>
export type User = z.infer<typeof userSchema>

// ── Catalogue ───────────────────────────────────────────────────────────────

export const productSchema = z.object({
  id: z.int(),
  code: z.string(),
  kind: z.enum(['lpg', 'petrol', 'diesel']),
  unit: z.enum(['cylinder', 'liter']),
  sizeKg: z.nullable(z.number()),
  label: z.string(),
  active: z.boolean(),
  sortOrder: z.int(),
  stations: z.int(),
  createdAt: isoDate,
  updatedAt: isoDate,
}) satisfies z.ZodMiniType<Schemas['AdminProduct']>
export type Product = z.infer<typeof productSchema>
export const productPageSchema = page(productSchema) satisfies z.ZodMiniType<Schemas['AdminProductPage']>

// ── Audit ───────────────────────────────────────────────────────────────────

export const auditEntrySchema = z.object({
  id: z.string(),
  actor: z.nullable(
    z.object({
      id: z.string(),
      role: nullableString,
      firstName: nullableString,
      lastName: nullableString,
      email: nullableString,
    }),
  ),
  action: z.string(),
  entityType: z.string(),
  entityId: nullableString,
  metadata: z.record(z.string(), z.unknown()),
  requestId: nullableString,
  createdAt: isoDate,
}) satisfies z.ZodMiniType<Schemas['AuditEntry']>
export type AuditEntry = z.infer<typeof auditEntrySchema>
export const auditPageSchema = page(auditEntrySchema) satisfies z.ZodMiniType<Schemas['AuditPage']>

// ── Exports ─────────────────────────────────────────────────────────────────

export const datasets = ['stations', 'stocks', 'search_stats', 'reports', 'audit'] as const
export type Dataset = (typeof datasets)[number]

export const exportSchema = z.object({
  id: z.string(),
  dataset: z.enum(datasets),
  format: z.enum(['csv', 'json']),
  params: z.object({ from: z.optional(z.string()), to: z.optional(z.string()), productId: z.optional(z.int()) }),
  status: z.enum(['pending', 'ready', 'failed', 'expired']),
  error: z.nullable(z.enum(['too_many_rows', 'generation_failed', 'timeout', 'queue_unavailable'])),
  rowCount: z.nullable(z.int()),
  sizeBytes: z.nullable(z.int()),
  requestedBy: z.nullable(z.object({ id: z.string(), firstName: z.string(), lastName: z.string() })),
  createdAt: isoDate,
  completedAt: nullableDate,
  expiresAt: nullableDate,
  download: z.nullable(z.object({ url: z.string(), expiresAt: isoDate })),
}) satisfies z.ZodMiniType<Schemas['Export']>
export type Export = z.infer<typeof exportSchema>
export const exportPageSchema = page(exportSchema) satisfies z.ZodMiniType<Schemas['ExportPage']>

// ── Pénuries ────────────────────────────────────────────────────────────────

export const shortageMapSchema = z.object({
  type: z.literal('FeatureCollection'),
  period: z.object({
    key: z.enum(['24h', '7d', '30d', 'custom']),
    from: isoDate,
    to: isoDate,
    previousFrom: isoDate,
    previousTo: isoDate,
    timezone: z.string(),
    granularity: z.enum(['hour', 'day']),
  }),
  productId: z.nullable(z.int()),
  k: z.int(),
  threshold: z.number(),
  maskedCells: z.int(),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      id: z.string(),
      geometry: z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.array(z.number()))) }),
      properties: z.object({
        cell: z.string(),
        searches: z.int(),
        emptySearches: z.int(),
        emptyRate: z.number(),
        shortage: z.boolean(),
      }),
    }),
  ),
}) satisfies z.ZodMiniType<Schemas['ShortageMap']>
export type ShortageMap = z.infer<typeof shortageMapSchema>
