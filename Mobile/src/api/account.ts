import { queryOptions } from '@tanstack/react-query'

import type { LatLng } from '@/lib/geo'

import { api, session, unwrap } from './client'
import { meKeys } from './keys'
import {
  favoriteListSchema,
  favoriteSchema,
  notificationPageSchema,
  notificationSettingsSchema,
  profileSchema,
  sessionListSchema,
  sessionResponseSchema,
} from './schemas'
import type { components } from './schema'

/** Version de la politique de confidentialité acceptée à l'inscription (texte final à l'étape 10). */
export const PRIVACY_POLICY_VERSION = '1.0'

// --- Session -----------------------------------------------------------------------------------

export async function login(email: string, password: string) {
  const res = await unwrap(api.POST('/api/v1/auth/login', { body: { email, password } }), sessionResponseSchema)
  await session.signIn(res)
  return res.user
}

export async function register(body: Omit<components['schemas']['RegisterRequest'], 'privacyPolicyVersion'>) {
  const res = await unwrap(
    api.POST('/api/v1/auth/register', { body: { ...body, privacyPolicyVersion: PRIVACY_POLICY_VERSION } }),
    sessionResponseSchema,
  )
  await session.signIn(res)
  return res.user
}

export const verifyEmail = (email: string, code: string) =>
  unwrap(api.POST('/api/v1/auth/verify-email', { body: { email, code } }))

export const resendVerification = (email: string) =>
  unwrap(api.POST('/api/v1/auth/resend-verification', { body: { email } }))

export const forgotPassword = (email: string) => unwrap(api.POST('/api/v1/auth/password/forgot', { body: { email } }))

export const resetPassword = (email: string, code: string, newPassword: string) =>
  unwrap(api.POST('/api/v1/auth/password/reset', { body: { email, code, newPassword } }))

/** Déconnexion : révoque la session côté serveur (best effort), puis efface les jetons locaux. */
export async function logout() {
  const refreshToken = session.currentRefreshToken()
  if (refreshToken) {
    await unwrap(api.POST('/api/v1/auth/logout', { body: { refreshToken } })).catch(() => undefined)
  }
  await session.clear()
}

export async function logoutAll() {
  await unwrap(api.POST('/api/v1/auth/logout-all'))
  await session.clear()
}

// --- Profil ------------------------------------------------------------------------------------

export const meQuery = queryOptions({
  queryKey: meKeys.profile(),
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/me', { signal }), profileSchema),
  staleTime: 60_000,
})

export const updateProfile = (body: { firstName: string; lastName: string }) =>
  unwrap(api.PATCH('/api/v1/me', { body }), profileSchema)

export const changePassword = (currentPassword: string, newPassword: string) =>
  unwrap(api.POST('/api/v1/me/change-password', { body: { currentPassword, newPassword } }))

export async function deleteAccount(password: string) {
  await unwrap(api.DELETE('/api/v1/me', { body: { password } }))
  await session.clear()
}

export const sessionsQuery = queryOptions({
  queryKey: meKeys.sessions(),
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/me/sessions', { signal }), sessionListSchema),
  select: (d) => d.items,
})

export const revokeSession = (id: string) =>
  unwrap(api.DELETE('/api/v1/me/sessions/{id}', { params: { path: { id } } }))

// --- Favoris -----------------------------------------------------------------------------------

export const favoritesQuery = queryOptions({
  queryKey: meKeys.favorites(),
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/me/favorites', { signal }), favoriteListSchema),
  select: (d) => d.items,
  staleTime: 30_000,
})

/** Ajoute (ou met à jour les alertes d'un) favori ; `alertProductIds` absent = inchangées. */
export const saveFavorite = (stationId: string, alertProductIds?: number[]) =>
  unwrap(
    api.POST('/api/v1/me/favorites/{stationId}', {
      params: { path: { stationId } },
      body: alertProductIds ? { alertProductIds } : {},
    }),
    favoriteSchema,
  )

export const removeFavorite = (stationId: string) =>
  unwrap(api.DELETE('/api/v1/me/favorites/{stationId}', { params: { path: { stationId } } }))

// --- Notifications -----------------------------------------------------------------------------

export const notificationsQuery = queryOptions({
  queryKey: meKeys.notifications(),
  queryFn: ({ signal }) =>
    unwrap(api.GET('/api/v1/me/notifications', { params: { query: { limit: 50 } }, signal }), notificationPageSchema),
  staleTime: 30_000,
})

export const markNotificationsRead = (body: { ids?: string[]; all?: boolean }) =>
  unwrap(api.POST('/api/v1/me/notifications/read', { body }))

export const notificationSettingsQuery = queryOptions({
  queryKey: meKeys.settings(),
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/me/notification-settings', { signal }), notificationSettingsSchema),
  select: (d) => d.items,
})

export const updateNotificationSettings = (settings: components['schemas']['NotificationSetting'][]) =>
  unwrap(api.PUT('/api/v1/me/notification-settings', { body: { settings } }), notificationSettingsSchema)

// --- Signalements ------------------------------------------------------------------------------

export type ReportReason = components['schemas']['ReportReason']

/**
 * Signalement. `position` (rupture, fermeture) ne sert qu'au contrôle des 2 km côté API : elle
 * part dans le corps de cette requête, puis n'est gardée nulle part (règle 2).
 */
export const createReport = (
  stationId: string,
  body: { reason: ReportReason; productId?: number; comment?: string; position?: LatLng },
) => unwrap(api.POST('/api/v1/stations/{id}/reports', { params: { path: { id: stationId } }, body }))
