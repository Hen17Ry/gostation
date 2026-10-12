import { createFileRoute } from '@tanstack/react-router'

import { alertsQuery } from '@/api/admin'
import { AlertsPage } from '@/features/alerts/alerts-page'
import { alertSearchSchema, toAlertFilters } from '@/features/alerts/filters'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/alerts')({
  validateSearch: alertSearchSchema,
  staticData: { title: t.nav.alerts },
  loaderDeps: ({ search }) => ({ filters: toAlertFilters(search) }),
  loader: ({ context, deps }) => {
    if (deps.filters) void context.queryClient.prefetchQuery(alertsQuery(deps.filters))
  },
  component: AlertsRoute,
})

function AlertsRoute() {
  return <AlertsPage search={Route.useSearch()} />
}
