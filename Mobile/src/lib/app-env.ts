/**
 * Environnement du serveur visé par ce build : EXPO_PUBLIC_APP_ENV, variable EAS du profil
 * `preview` (staging). Le staging se signale par un bandeau sur chaque écran et propose un
 * plantage de test (Compte) ; rien de tout cela en production.
 */
export function isStaging(): boolean {
  return process.env.EXPO_PUBLIC_APP_ENV === 'staging'
}

/**
 * Plantage de test (Compte, staging) : erreur JavaScript fatale levée hors de React, que le
 * gestionnaire global du SDK envoie à GlitchTip avant l'arrêt de l'instance React. Pas
 * Sentry.nativeCrash() : sous la New Architecture, ReactHost intercepte l'exception du module natif
 * (écran blanc, processus vivant, aucun rapport : vu sur le staging).
 */
export function triggerTestCrash(): void {
  setTimeout(() => {
    throw new Error('GoStation staging test crash')
  }, 0)
}
