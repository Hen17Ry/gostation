import { useEffect } from 'react'

import type { Profile } from '@/api/schemas'
import { useMe } from '@/features/auth/use-me'
import { type SpaceHint, usePrefs } from '@/stores/prefs'

/**
 * Espace de l'app (D58) : `user` (recherche, favoris…), `manager` (station approuvée : stocks,
 * station, signalements) ou `manager-status` (dossier en attente, rejeté ou suspendu : écran de
 * statut seulement). Sans session : `user`. Avant la réponse de `GET /me` (démarrage, hors
 * connexion) : l'espace mémorisé du dernier compte.
 */
export type Space = 'user' | 'manager' | 'manager-status'

export function spaceOf(hint: SpaceHint | null): Space {
  if (hint?.role !== 'manager') return 'user'
  return hint.stationStatus === 'approved' ? 'manager' : 'manager-status'
}

export const hintOf = (me: Profile): SpaceHint => ({ role: me.role, stationStatus: me.station?.status ?? null })

/** Accueil de chaque espace (aussi la cible d'un lien vers un espace qui n'est pas le sien, D61). */
export const SPACE_HOME = { user: '/', manager: '/manager/stocks', 'manager-status': '/manager/status' } as const

export function useSpace(): Space {
  const { me, signedIn } = useMe()
  const hint = usePrefs((s) => s.space)
  const setSpace = usePrefs((s) => s.setSpace)
  const fresh = me ? hintOf(me) : null

  // Mémorise l'espace du compte (et l'oublie à la déconnexion).
  useEffect(() => {
    if (!signedIn) {
      if (hint) setSpace(null)
      return
    }
    if (fresh && (fresh.role !== hint?.role || fresh.stationStatus !== hint?.stationStatus)) setSpace(fresh)
  }, [signedIn, fresh?.role, fresh?.stationStatus, hint, setSpace]) // eslint-disable-line react-hooks/exhaustive-deps -- fresh est recréé à chaque rendu

  if (!signedIn) return 'user'
  return spaceOf(fresh ?? hint)
}
