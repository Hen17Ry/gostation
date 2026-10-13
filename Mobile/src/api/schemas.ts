/**
 * Validation zod des réponses de l'API utilisées par l'app (CLAUDE.md : réponses validées).
 * Chaque schéma est vérifié à la compilation contre le type généré depuis openapi.yaml
 * (`satisfies`) : un écart entre la spec et le client casse le typecheck.
 */
import * as z from 'zod/mini'

import type { components } from './schema'

type Schemas = components['schemas']

const isoDate = z.string().check(z.minLength(1))
const nullableString = z.nullable(z.string())
const latLng = z.object({ lat: z.number(), lng: z.number() })

export const productSchema = z.object({
  id: z.int(),
  code: z.string(),
  kind: z.enum(['lpg', 'petrol', 'diesel']),
  unit: z.enum(['cylinder', 'liter']),
  sizeKg: z.nullable(z.number()),
  label: z.string(),
}) satisfies z.ZodMiniType<Schemas['Product']>
export type Product = z.infer<typeof productSchema>
export const productListSchema = z.object({ items: z.array(productSchema) }) satisfies z.ZodMiniType<
  Schemas['ProductList']
>

export const searchResultSchema = z.object({
  station: z.object({ id: z.string(), name: z.string(), brand: nullableString, location: latLng }),
  distanceM: z.int(),
  routeDistanceM: z.nullable(z.int()),
  durationS: z.nullable(z.int()),
  quantity: z.int(),
  stale: z.boolean(),
  stockUpdatedAt: isoDate,
  updatedAgoS: z.int(),
  isOpen: z.boolean(),
  nextOpening: z.nullable(isoDate),
  servedAt: z.nullable(isoDate),
  reported: z.boolean(),
}) satisfies z.ZodMiniType<Schemas['SearchResult']>
export type SearchResult = z.infer<typeof searchResultSchema>

export const searchResponseSchema = z.object({
  product: z.object({ id: z.int(), code: z.string(), label: z.string(), unit: z.enum(['cylinder', 'liter']) }),
  strategy: z.enum(['radius', 'fallback', 'none']),
  radiusM: z.nullable(z.literal([500, 1000, 2000, 5000, 10000, 25000, 50000])),
  routingApproximate: z.boolean(),
  results: z.array(searchResultSchema),
  generatedAt: isoDate,
}) satisfies z.ZodMiniType<Schemas['SearchResponse']>
export type SearchResponse = z.infer<typeof searchResponseSchema>

const openingDay = z.object({
  weekday: z.int(),
  is24h: z.boolean(),
  ranges: z.array(z.object({ opens: z.string(), closes: z.string() })),
})

export const publicStationSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: nullableString,
  address: z.string(),
  city: nullableString,
  reported: z.boolean(),
  location: z.nullable(latLng),
  openingHours: z.object({
    timezone: z.string(),
    isOpenNow: z.boolean(),
    nextOpening: z.nullable(isoDate),
    days: z.array(openingDay),
    closures: z.array(z.string()),
  }),
  stocks: z.array(
    z.object({
      productId: z.int(),
      code: z.string(),
      label: z.string(),
      unit: z.enum(['cylinder', 'liter']),
      sizeKg: z.nullable(z.number()),
      quantity: z.nullable(z.int()),
      updatedAt: isoDate,
      freshness: z.enum(['fresh', 'stale', 'expired']),
      reported: z.boolean(),
    }),
  ),
}) satisfies z.ZodMiniType<Schemas['PublicStation']>
export type PublicStation = z.infer<typeof publicStationSchema>

export const routeSchema = z.object({
  stationId: z.string(),
  distanceM: z.int(),
  durationS: z.int(),
  geometry: z.string(),
  geometryEncoding: z.literal('polyline6'),
  steps: z.array(
    z.object({
      maneuver: z.object({
        type: z.string(),
        modifier: z.optional(z.string()),
        exit: z.optional(z.int()),
        location: latLng,
      }),
      name: z.string(),
      ref: z.optional(z.string()),
      distanceM: z.number(),
      durationS: z.number(),
    }),
  ),
}) satisfies z.ZodMiniType<Schemas['Route']>
export type Route = z.infer<typeof routeSchema>
export type RouteStep = Route['steps'][number]

export const profileSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.enum(['user', 'manager', 'admin']),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  privacyPolicy: z.object({
    acceptedVersion: z.string(),
    acceptedAt: isoDate,
    currentVersion: z.string(),
    reacceptRequired: z.boolean(),
  }),
  station: z.nullable(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['pending', 'approved', 'rejected', 'suspended']),
      statusReason: nullableString,
    }),
  ),
  createdAt: isoDate,
}) satisfies z.ZodMiniType<Schemas['Profile']>
export type Profile = z.infer<typeof profileSchema>

export const tokenPairSchema = z.object({
  accessToken: z.string().check(z.minLength(1)),
  tokenType: z.literal('Bearer'),
  expiresIn: z.int(),
  refreshToken: z.string().check(z.minLength(1)),
  refreshExpiresIn: z.int(),
}) satisfies z.ZodMiniType<Schemas['TokenPair']>
export type TokenPair = z.infer<typeof tokenPairSchema>

export const sessionResponseSchema = z.object({
  ...tokenPairSchema.shape,
  user: profileSchema,
}) satisfies z.ZodMiniType<Schemas['SessionResponse']>
export type SessionResponse = z.infer<typeof sessionResponseSchema>

export const favoriteSchema = z.object({
  station: z.object({
    id: z.string(),
    name: z.string(),
    brand: nullableString,
    address: z.string(),
    city: nullableString,
    location: z.nullable(latLng),
  }),
  available: z.boolean(),
  alertProductIds: z.array(z.int()),
  createdAt: isoDate,
}) satisfies z.ZodMiniType<Schemas['Favorite']>
export type Favorite = z.infer<typeof favoriteSchema>
export const favoriteListSchema = z.object({ items: z.array(favoriteSchema) }) satisfies z.ZodMiniType<
  Schemas['FavoriteList']
>

const notificationType = z.enum(['stock_reminder', 'station_reported', 'back_in_stock'])

export const notificationSchema = z.object({
  id: z.string(),
  type: notificationType,
  data: z.record(z.string(), z.unknown()),
  createdAt: isoDate,
  readAt: z.nullable(isoDate),
}) satisfies z.ZodMiniType<Schemas['Notification']>
export type Notification = z.infer<typeof notificationSchema>
export const notificationPageSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: nullableString,
  unreadCount: z.int(),
}) satisfies z.ZodMiniType<Schemas['NotificationPage']>

export const notificationSettingsSchema = z.object({
  items: z.array(z.object({ type: notificationType, enabled: z.boolean() })),
}) satisfies z.ZodMiniType<Schemas['NotificationSettingList']>
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>

export const sessionListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      client: z.enum(['mobile', 'web']),
      userAgent: z.string(),
      createdAt: isoDate,
      lastUsedAt: isoDate,
      current: z.boolean(),
    }),
  ),
}) satisfies z.ZodMiniType<Schemas['SessionList']>
export type SessionInfo = z.infer<typeof sessionListSchema>['items'][number]
