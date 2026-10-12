import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'

import { isApiError } from '@/api/errors'
import { t } from '@/i18n'

/** Message français d'une erreur de champ de l'API (`errors[].code`). */
export function fieldMessage(field: string, code: string): string {
  return (
    t.fieldErrors[code as keyof typeof t.fieldErrors] ??
    (field === 'email' ? t.validation.email : t.validation.required)
  )
}

/**
 * Reporte les erreurs de champ d'une réponse 422 sur le formulaire ; renvoie le message général à
 * afficher (null si tout a été rattaché à des champs visibles).
 */
export function applyApiErrors<T extends FieldValues>(
  e: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): string | null {
  if (!isApiError(e)) return t.common.errorTitle
  let attached = 0
  for (const f of e.fields) {
    if (fields.includes(f.field)) {
      setError(f.field as Path<T>, { message: fieldMessage(f.field, f.code) })
      attached++
    }
  }
  return attached > 0 && attached === e.fields.length ? null : e.userMessage
}
