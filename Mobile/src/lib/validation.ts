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

// --- Station (inscription gérant, « Ma station ») : mêmes règles que l'API (station/profile.go) ---

const PHONE_NOISE = /[\s.\-()]/g
/** Téléphone normalisé comme l'API : sans espaces, points, tirets ni parenthèses. */
export const normalizePhone = (v: string) => v.replace(PHONE_NOISE, '')
export const IFU_LENGTH = 13

export const stationNameField = z
  .string()
  .check(
    z.trim(),
    z.minLength(2, { error: t.manager.validation.stationName }),
    z.maxLength(120, { error: t.manager.validation.stationName }),
  )
export const brandField = z.string().check(z.trim(), z.maxLength(60, { error: t.fieldErrors.too_long! }))
export const ifuField = z.string().check(z.trim(), z.regex(/^\d{13}$/, { error: t.manager.validation.ifu }))
export const rccmField = z
  .string()
  .check(z.trim(), z.regex(/^[A-Za-z0-9][A-Za-z0-9 /.-]{3,48}[A-Za-z0-9]$/, { error: t.manager.validation.rccm }))
export const addressField = z
  .string()
  .check(
    z.trim(),
    z.minLength(5, { error: t.manager.validation.address }),
    z.maxLength(255, { error: t.manager.validation.address }),
  )
export const cityField = z.string().check(z.trim(), z.maxLength(100, { error: t.fieldErrors.too_long! }))
export const phoneField = z
  .string()
  .check(z.refine((v) => /^\+[1-9]\d{7,14}$/.test(normalizePhone(v.trim())), { error: t.manager.validation.phone }))

export const stationFields = {
  name: stationNameField,
  brand: brandField,
  ifu: ifuField,
  rccm: rccmField,
  address: addressField,
  city: cityField,
  phone: phoneField,
}
