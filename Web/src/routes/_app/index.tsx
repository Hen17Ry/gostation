import { createFileRoute } from '@tanstack/react-router'

import { dashboardQuery } from '@/api/queries'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { normalizePeriod, periodSearchSchema } from '@/features/dashboard/period'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/')({
  validateSearch: periodSearchSchema,
  staticData: { title: t.dashboard.title },
  loaderDeps: ({ search }) => normalizePeriod(search),
  // Préchargement sans attendre : la page affiche ses squelettes pendant la requête.
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(dashboardQuery(deps))
  },
  component: Dashboard,
})

function Dashboard() {
  const search = Route.useSearch()
  return <DashboardPage period={normalizePeriod(search)} />
}
