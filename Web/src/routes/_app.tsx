import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet, redirect, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'

import { session } from '@/api/client'
import { isApiError } from '@/api/errors'
import { meQuery } from '@/api/queries'
import { AppShell } from '@/components/layout/app-shell'

const isAuthError = (e: unknown) => isApiError(e) && (e.status === 401 || e.status === 403)

/**
 * Espace authentifié : session admin (cookie, 2FA passée) obligatoire. Une session connue de ce
 * navigateur affiche la coquille tout de suite, `/me` étant vérifié en parallèle (redirection
 * vers la connexion s'il échoue) ; sans session connue, on attend la réponse (première visite :
 * connexion directe, sans coquille). La page demandée est gardée (?redirect=).
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const cached = context.queryClient.getQueryData(meQuery.queryKey)
    if (cached) {
      if (cached.role !== 'admin') throw redirect({ to: '/login', search: { redirect: location.href } })
      return
    }
    if (session.hasSession()) {
      void context.queryClient.prefetchQuery(meQuery)
      return
    }
    try {
      const me = await context.queryClient.ensureQueryData(meQuery)
      if (me.role !== 'admin') throw redirect({ to: '/login', search: { redirect: location.href } })
    } catch (e) {
      if (isAuthError(e)) {
        const reason = session.consumeExpired() ? ('expired' as const) : undefined
        throw redirect({ to: '/login', search: { redirect: location.href, reason } })
      }
      throw e
    }
  },
  component: AppLayout,
})

function AppLayout() {
  const router = useRouter()
  const me = useQuery(meQuery)
  const denied = (me.isError && isAuthError(me.error)) || (me.data !== undefined && me.data.role !== 'admin')

  // Vérification parallèle échouée : retour à la connexion, en gardant la page demandée.
  useEffect(() => {
    // Session expirée (refresh impossible) : le gestionnaire global redirige déjà, avec le motif.
    if (!denied || router.latestLocation.pathname === '/login') return
    const reason = session.consumeExpired() ? ('expired' as const) : undefined
    void router.navigate({
      to: '/login',
      search: { redirect: router.state.location.href, reason },
      replace: true,
    })
  }, [denied, router])

  if (me.isError && !denied) throw me.error
  return (
    <AppShell me={denied ? undefined : me.data}>
      <Outlet />
    </AppShell>
  )
}
