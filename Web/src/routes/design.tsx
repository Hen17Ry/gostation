import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router'

import { NotFound } from '@/components/feedback/not-found'

/**
 * Page /design : développement uniquement. En production, la route répond « introuvable » et
 * l'import de la page disparaît du build (branche morte sur import.meta.env.DEV).
 */
export const Route = createFileRoute('/design')({
  staticData: { title: 'Design system' },
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: import.meta.env.DEV ? lazyRouteComponent(() => import('@/features/design/design-page')) : NotFound,
})
