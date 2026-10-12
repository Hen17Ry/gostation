import type { QueryClient } from '@tanstack/react-query'

import { api, session, unwrap } from '@/api/client'
import { authKeys } from '@/api/keys'
import { adminChallengeSchema, adminSessionSchema, type AdminSession } from '@/api/schemas'

/** Étape 1 : mot de passe → défi 2FA (mise en place ou vérification). */
export function adminLogin(email: string, password: string) {
  return unwrap(api.POST('/api/v1/auth/admin/login', { body: { email, password } }), adminChallengeSchema)
}

export type SecondFactor = { code: string } | { recoveryCode: string }

/** Étape 2 : code TOTP ou code de secours → cookies de session (+ codes de secours à la mise en place). */
export async function adminSecondFactor(
  qc: QueryClient,
  mfaToken: string,
  factor: SecondFactor,
): Promise<AdminSession> {
  const s = await unwrap(api.POST('/api/v1/auth/admin/2fa', { body: { mfaToken, ...factor } }), adminSessionSchema)
  session.setCsrfToken(s.csrfToken)
  qc.setQueryData(authKeys.me(), s.user)
  return s
}

/** Déconnexion : révoque la session côté serveur (idempotent), puis oublie tout côté client. */
export async function logout(qc: QueryClient) {
  try {
    await unwrap(api.POST('/api/v1/auth/logout', {}))
  } finally {
    session.clear()
    qc.clear()
  }
}

/** Normalise un code de secours saisi (casse, espaces, tirets) au format XXXX-XXXX-XXXX-XXXX. */
export function normalizeRecoveryCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[\s-]/g, '')
  return s.match(/.{1,4}/g)?.join('-') ?? ''
}

export const RECOVERY_CODE_PATTERN = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/

/** Destination après connexion : chemin interne uniquement (pas de redirection ouverte). */
export function safeRedirect(target: string | undefined): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return '/'
  if (target === '/login' || target.startsWith('/login?')) return '/'
  return target
}
