/**
 * Environnement du serveur visé par ce build : EXPO_PUBLIC_APP_ENV, variable EAS du profil
 * `preview` (staging). Le staging se signale par un bandeau sur chaque écran et propose un
 * plantage de test (Compte) ; rien de tout cela en production.
 */
export function isStaging(): boolean {
  return process.env.EXPO_PUBLIC_APP_ENV === 'staging'
}
