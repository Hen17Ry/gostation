import { isApiError } from '@/api/errors'

import { scrubEvent } from './scrub'

/**
 * Suivi des plantages (GlitchTip auto-hébergé, compatible Sentry, D90). Rien n'est chargé ni
 * envoyé sans VITE_SENTRY_DSN ; sinon le SDK est chargé après le premier rendu (hors du budget du
 * JS initial). Seules les erreurs JavaScript inattendues partent : les erreurs d'API (réseau, 4xx,
 * 5xx) sont déjà connues du serveur. Aucune intégration automatique hormis les erreurs globales :
 * ni fil d'Ariane (clics, requêtes, console), ni session, ni en-têtes.
 */
type Sdk = typeof import('@sentry/browser')

let sdk: Promise<Sdk> | null = null

export function startErrorTracking(dsn = import.meta.env.VITE_SENTRY_DSN): void {
  if (!dsn || sdk) return
  sdk = import('@sentry/browser').then((S) => {
    S.init({
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
      defaultIntegrations: false,
      integrations: [
        S.globalHandlersIntegration(),
        S.linkedErrorsIntegration(),
        S.dedupeIntegration(),
        S.browserApiErrorsIntegration(),
      ],
      // Rien de collecté automatiquement : ni utilisateur, ni cookies, ni en-têtes, ni corps, ni
      // paramètres d'URL (scrubEvent repasse derrière).
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
      beforeBreadcrumb: () => null,
      beforeSend: (event, hint) => (isApiError(hint.originalException) ? null : scrubEvent(event)),
    })
    return S
  })
}

/** Erreur attrapée par un error boundary (écran ou racine). */
export function reportError(error: unknown): void {
  if (isApiError(error)) return
  void sdk?.then((S) => S.captureException(error))
}
