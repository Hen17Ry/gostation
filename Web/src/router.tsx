import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'

import { onSessionExpired, session } from '@/api/client'
import { isApiError } from '@/api/errors'
import { RouteError } from '@/components/feedback/route-error'
import { NotFound } from '@/components/feedback/not-found'
import { PageSkeleton } from '@/components/feedback/page-skeleton'

import { routeTree } from './routeTree.gen'

export const queryClient = new QueryClient({
  queryCache: new QueryCache(),
  mutationCache: new MutationCache(),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Nouvel essai seulement sur erreur réseau ou 5xx (CLAUDE.md, gestion des erreurs).
      retry: (count, error) => count < 2 && isApiError(error) && error.isRetryable,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
})

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  defaultPendingComponent: PageSkeleton,
  defaultPendingMs: 150,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: NotFound,
  scrollRestoration: true,
})

// Session expirée (refresh impossible) : retour à la connexion, en gardant la page demandée.
// Pendant une navigation, c'est la garde de /_app qui redirige (elle lit le même motif). Le cache
// n'est jamais vidé ici : une requête en cours (la garde attend /me) serait annulée. La route
// /login l'efface à l'arrivée.
onSessionExpired(() => {
  const { pathname, href } = router.state.location
  if (pathname === '/login' || router.state.isLoading) return
  session.consumeExpired()
  void router.navigate({ to: '/login', search: { redirect: href, reason: 'expired' }, replace: true })
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
  interface StaticDataRouteOption {
    /** Libellé du fil d'Ariane et du titre de l'onglet. */
    title?: string
  }
}
