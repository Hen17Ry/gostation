import { createFileRoute } from '@tanstack/react-router'

import { reportsQuery } from '@/api/admin'
import { reportSearchSchema, toReportFilters } from '@/features/reports/filters'
import { ReportsPage } from '@/features/reports/reports-page'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/reports')({
  validateSearch: reportSearchSchema,
  staticData: { title: t.nav.reports },
  loaderDeps: ({ search }) => toReportFilters(search),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(reportsQuery(deps))
  },
  component: ReportsRoute,
})

function ReportsRoute() {
  return <ReportsPage search={Route.useSearch()} />
}
