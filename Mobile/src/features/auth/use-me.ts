import { useQuery } from '@tanstack/react-query'

import { meQuery } from '@/api/account'
import { useAuth } from '@/stores/auth'

/** Profil du compte connecté (undefined sans session). */
export function useMe() {
  const signedIn = useAuth((s) => s.status === 'signedIn')
  const q = useQuery({ ...meQuery, enabled: signedIn })
  return { ...q, me: signedIn ? q.data : undefined, signedIn }
}
