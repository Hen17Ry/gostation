/**
 * Validation zod des réponses API utilisées par l'admin (CLAUDE.md : réponses validées).
 * zod/mini (zod 4, API fonctionnelle) : seules les briques employées partent dans le JS initial.
 * Chaque schéma est vérifié à la compilation contre le type généré depuis openapi.yaml
 * (`satisfies`) : un écart entre la spec et le client casse le typecheck.
 */
import * as z from 'zod/mini'

import type { Schemas } from './client'

export const isoDate = z.string().check(z.minLength(1))

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
      statusReason: z.nullable(z.string()),
    }),
  ),
  createdAt: isoDate,
}) satisfies z.ZodMiniType<Schemas['Profile']>
export type Profile = z.infer<typeof profileSchema>

export const adminChallengeSchema = z.object({
  mfaToken: z.string().check(z.minLength(1)),
  twoFactor: z.enum(['setup_required', 'required']),
  expiresIn: z.int().check(z.positive()),
  setup: z.optional(
    z.object({ secret: z.string().check(z.minLength(1)), otpauthUri: z.string().check(z.startsWith('otpauth://')) }),
  ),
}) satisfies z.ZodMiniType<Schemas['AdminChallenge']>
export type AdminChallenge = z.infer<typeof adminChallengeSchema>

export const adminSessionSchema = z.object({
  user: profileSchema,
  csrfToken: z.string().check(z.minLength(1)),
  expiresIn: z.int(),
  recoveryCodes: z.optional(z.array(z.string())),
}) satisfies z.ZodMiniType<Schemas['AdminSession']>
export type AdminSession = z.infer<typeof adminSessionSchema>

// Types du tableau de bord : import de type seul, le schéma reste hors du JS initial.
export type { Dashboard, Kpi } from './dashboard-schema'
