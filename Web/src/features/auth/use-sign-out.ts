import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { logout } from './api'

/** Déconnexion : révocation côté serveur, oubli local, retour à la connexion. */
export function useSignOut() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  async function signOut() {
    setPending(true)
    try {
      await logout(qc)
    } catch {
      // Session déjà close ou réseau coupé : la session locale est oubliée quand même.
    } finally {
      setPending(false)
      await navigate({ to: '/login', search: { reason: 'signed-out' }, replace: true })
    }
  }
  return { signOut, pending }
}
