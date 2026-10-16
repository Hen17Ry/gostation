import { PRIVACY_POLICY_VERSION } from '@/api/account'
import type { Profile } from '@/api/schemas'
import { useMe } from '@/features/auth/use-me'

/**
 * Réacceptation de la politique de confidentialité : `accept` quand le serveur publie une version
 * que le compte n'a pas acceptée et que l'app la contient ; `outdated` quand l'app livre une autre
 * version (elle doit être mise à jour pour la montrer) ; `ok` sinon.
 */
export type PolicyState = 'ok' | 'accept' | 'outdated'

export function policyState(me: Profile | undefined, bundled = PRIVACY_POLICY_VERSION): PolicyState {
  if (!me?.privacyPolicy.reacceptRequired) return 'ok'
  return me.privacyPolicy.currentVersion === bundled ? 'accept' : 'outdated'
}

/** Vrai tant que le compte connecté doit accepter une nouvelle version (écran policy-update). */
export function useMustAcceptPolicy(): boolean {
  const { me } = useMe()
  return policyState(me) !== 'ok'
}
