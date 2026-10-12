import * as z from 'zod/mini'

import { t } from '@/i18n'

/** Règles de saisie partagées (mêmes bornes que l'API ; l'API reste juge en dernier ressort). */
export const emailField = z
  .string()
  .check(
    z.trim(),
    z.minLength(1, { error: t.validation.required }),
    z.maxLength(254, { error: t.validation.email }),
    z.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { error: t.validation.email }),
  )
export const passwordField = z.string().check(z.minLength(1, { error: t.validation.required }))
export const newPasswordField = z
  .string()
  .check(z.minLength(8, { error: t.validation.password }), z.maxLength(128, { error: t.validation.password }))
export const nameField = z.string().check(z.trim(), z.minLength(1, { error: t.validation.required }), z.maxLength(100))
export const codeField = z.string().check(z.regex(/^\d{6}$/, { error: t.validation.code }))
