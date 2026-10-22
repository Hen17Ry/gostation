import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import type { LatLng } from '@/lib/geo'

import { useLocation } from './location-store'

/**
 * Permission relue au retour au premier plan : l'utilisateur revient des réglages du système, où
 * il a pu l'accorder, la retirer ou passer en position précise (`useFocusEffect` ne se déclenche
 * pas dans ce cas). Nouvellement accordée : la position est mesurée et passée à `onLocated`.
 */
export function useLocationPermissionSync(onLocated?: (p: LatLng) => void) {
  const located = useRef(onLocated)
  useEffect(() => {
    located.current = onLocated
  }, [onLocated])
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      void (async () => {
        const before = useLocation.getState().permission
        const after = await useLocation.getState().refreshPermission()
        if (after !== 'granted' || before === 'granted') return
        const p = await useLocation.getState().locate()
        if (p) located.current?.(p)
      })()
    })
    return () => sub.remove()
  }, [])
}
