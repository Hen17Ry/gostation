import { ApiError, isApiError } from '@/api/errors'
import { t } from '@/i18n'

/** Encadré affiché en tête d'une étape de connexion. */
export interface Notice {
  variant: 'info' | 'success' | 'destructive'
  title?: string
  body: string
}

export const asApiError = (e: unknown) => (isApiError(e) ? e : ApiError.network(e))

/** Message d'une erreur de connexion ; le compte désactivé a son propre encadré. */
export function errorNotice(e: ApiError): Notice {
  if (e.code === 'auth.account_disabled') {
    return { variant: 'destructive', title: t.auth.disabledTitle, body: t.auth.disabledBody }
  }
  return { variant: 'destructive', body: e.userMessage }
}
