import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { EnvRibbon } from '@/components/layout/env-badge'

// Conteneur des toasts monté hors du premier rendu : sonner reste hors du JS initial et ne
// retarde pas l'affichage de la page (un Suspense en attente dans le premier rendu le ferait).
const Toaster = lazy(() => import('@/components/ui/sonner').then((m) => ({ default: m.Toaster })))

function DeferredToaster() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    // Quand le navigateur est libre (au plus tard 2 s), ou dès la première interaction : un toast
    // suit toujours une action, et un toast émis avant le montage serait perdu.
    const show = () => setReady(true)
    const opts = { capture: true, once: true } as const
    window.addEventListener('pointerdown', show, opts)
    window.addEventListener('keydown', show, opts)
    const idle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(show, { timeout: 2000 })
        : window.setTimeout(show, 1000)
    return () => {
      window.removeEventListener('pointerdown', show, opts)
      window.removeEventListener('keydown', show, opts)
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idle)
      else window.clearTimeout(idle)
    }
  }, [])
  if (!ready) return null
  const toaster = (
    <Suspense fallback={null}>
      <Toaster />
    </Suspense>
  )
  const host = document.getElementById('toasts')
  return host ? createPortal(toaster, host) : toaster
}

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
})

function Root() {
  return (
    <>
      <EnvRibbon />
      <Outlet />
      <DeferredToaster />
    </>
  )
}
