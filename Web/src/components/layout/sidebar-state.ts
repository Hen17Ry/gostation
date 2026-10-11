import { useCallback, useState } from 'react'

const KEY = 'gs-sidebar-collapsed'

function initial(): boolean {
  try {
    const v = localStorage.getItem(KEY)
    if (v !== null) return v === '1'
  } catch {
    // Préférence non mémorisable : on retombe sur la largeur d'écran.
  }
  // Sans préférence : rail d'icônes sur tablette et petit portable, barre complète au-delà.
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches
}

/** Barre latérale repliée ou non, mémorisée dans le navigateur. */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(initial)
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? '0' : '1')
      } catch {
        // ignoré
      }
      return !c
    })
  }, [])
  return { collapsed, toggle }
}

export const SIDEBAR_WIDTH = 248
export const SIDEBAR_RAIL = 60
