import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form'
import type * as z from 'zod/mini'

/**
 * Résolveur react-hook-form pour zod/mini. `@hookform/resolvers` tirerait zod complet (≈ 900 Ko de
 * sources dans le bundle) ; nos formulaires n'ont que des champs plats : la première erreur de
 * chaque champ suffit.
 */
export function zodResolver<T extends FieldValues>(schema: z.ZodMiniType<T>): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(values)
    if (result.success) return { values: result.data, errors: {} }
    const errors: Record<string, { type: string; message: string }> = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.')
      errors[key] ??= { type: issue.code, message: issue.message }
    }
    return { values: {}, errors: errors as FieldErrors<T> }
  }
}
