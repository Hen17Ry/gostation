import { createFileRoute, redirect } from '@tanstack/react-router'
import * as z from 'zod/mini'

import { session } from '@/api/client'
import { meQuery } from '@/api/queries'
import { safeRedirect } from '@/features/auth/api'
import { LoginPage } from '@/features/auth/login-page'
import { t } from '@/i18n'

const searchSchema = z.object({
  redirect: z.catch(z.optional(z.string()), undefined),
  reason: z.catch(z.optional(z.enum(['expired', 'signed-out'])), undefined),
})

export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
  staticData: { title: t.auth.signInTitle },
  // Session encore valide : directement à destination.
  beforeLoad: async ({ context, search }) => {
    if (!session.hasSession()) {
      // Plus de session : aucune donnée de la session précédente ne reste en mémoire.
      context.queryClient.removeQueries()
      return
    }
    try {
      await context.queryClient.ensureQueryData(meQuery)
    } catch {
      return
    }
    throw redirect({ href: safeRedirect(search.redirect), replace: true })
  },
  // Pas de squelette de tableau de bord pendant le chargement de l'écran de connexion.
  pendingComponent: () => null,
  component: Login,
})

function Login() {
  const { redirect, reason } = Route.useSearch()
  return <LoginPage redirect={redirect} reason={reason} />
}
