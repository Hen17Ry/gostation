import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { session } from '@/api/client'
import { meKeys } from '@/api/keys'
import { useAuth } from '@/stores/auth'

/**
 * Au démarrage : lit le refresh token (Keystore) pour savoir si une session existe, sans appel
 * réseau (le profil se charge ensuite). Suit les connexions et déconnexions : à la déconnexion,
 * toutes les données du compte sont retirées du cache.
 */
export function useAuthBootstrap() {
  const qc = useQueryClient()
  const setStatus = useAuth((s) => s.setStatus)
  useEffect(() => {
    let alive = true
    void session.load().then((has) => alive && setStatus(has ? 'signedIn' : 'signedOut'))
    const off = session.onChange((signedIn) => {
      setStatus(signedIn ? 'signedIn' : 'signedOut')
      if (!signedIn) qc.removeQueries({ queryKey: meKeys.all })
    })
    return () => {
      alive = false
      off()
    }
  }, [qc, setStatus])
}
