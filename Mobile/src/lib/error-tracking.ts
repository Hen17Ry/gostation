import * as Sentry from '@sentry/react-native'

import { isApiError } from '@/api/errors'

import { scrubEvent } from './scrub'

/**
 * Suivi des plantages (GlitchTip auto-hébergé, compatible Sentry, D90). Sans
 * EXPO_PUBLIC_SENTRY_DSN, rien n'est initialisé ni envoyé. Sinon : erreurs JavaScript non
 * attrapées et plantages natifs, sans fil d'Ariane, session, capture d'écran ni mesure de
 * performance. Les événements JavaScript passent par scrubEvent ; ceux du SDK natif (plantage
 * Android) ne portent que la pile et l'appareil, avec un utilisateur constant (sans lui, le SDK
 * Android utiliserait un identifiant d'installation), et l'IP de l'appareil n'atteint jamais
 * GlitchTip (le proxy la remplace, deploy/Caddyfile). Les erreurs d'API sont connues du serveur.
 */
export function startErrorTracking(dsn = process.env.EXPO_PUBLIC_SENTRY_DSN): boolean {
  if (!dsn) return false
  // Diagnostic (build preview seulement) : journaux du SDK dans logcat et un message de test au
  // démarrage, pour vérifier la chaîne d'envoi sans planter l'app.
  const debug = process.env.EXPO_PUBLIC_SENTRY_DEBUG === '1'
  Sentry.init({
    dsn,
    debug,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || (__DEV__ ? 'development' : 'production'),
    sendDefaultPii: false,
    enableNative: true,
    enableNativeCrashHandling: true,
    enableAutoSessionTracking: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    enableAppStartTracking: false,
    enableNativeFramesTracking: false,
    enableStallTracking: false,
    enableUserInteractionTracing: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: (event, hint) => (isApiError(hint.originalException) ? null : scrubEvent(event)),
  })
  Sentry.setUser({ id: 'anonymous' })
  if (debug) Sentry.captureMessage('GoStation diagnostic: error tracking started')
  return true
}
