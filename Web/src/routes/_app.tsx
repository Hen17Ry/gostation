import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { session } from '@/api/client'
import { isApiError } from '@/api/errors'
import { meQuery } from '@/api/queries'
import { AppShell } from '@/components/layout/app-shell'

/**
 * Espace authentifié : session admin (cookie, 2FA passée) obligatoire. Sans session, retour à la
 * connexion en gardant la page demandée (?redirect=).
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    try {
      const me = await context.queryClient.ensureQueryData(meQuery)
      if (me.role !== 'admin') throw redirect({ to: '/login', search: { redirect: location.href } })
      return { me }
    } catch (e) {
      if (isApiError(e) && (e.status === 401 || e.status === 403)) {
        const reason = session.consumeExpired() ? ('expired' as const) : undefined
        throw redirect({ to: '/login', search: { redirect: location.href, reason } })
      }
      throw e
    }
  },
  component: AppLayout,
})

function AppLayout() {
  const { me } = Route.useRouteContext()
  return (
    <AppShell me={me}>
      <Outlet />
    </AppShell>
  )
}
