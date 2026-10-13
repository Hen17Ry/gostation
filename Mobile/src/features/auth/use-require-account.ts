import { router } from 'expo-router'

import { useMe } from './use-me'

/**
 * Garde des fonctions réservées aux comptes (favoris, signalements, notifications) : sans session,
 * ouvre la connexion ; email non vérifié, ouvre la saisie du code. Renvoie true si l'action peut
 * continuer.
 */
export function useRequireAccount() {
  const { me, signedIn } = useMe()
  return {
    me,
    ready: !!me?.emailVerified,
    ensure(): boolean {
      if (!signedIn) {
        router.push({ pathname: '/auth/sign-in', params: { reason: 'required' } })
        return false
      }
      if (me && !me.emailVerified) {
        router.push({ pathname: '/auth/verify', params: { email: me.email } })
        return false
      }
      return !!me
    },
  }
}
