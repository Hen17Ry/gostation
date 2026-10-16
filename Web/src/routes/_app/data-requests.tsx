import { createFileRoute } from '@tanstack/react-router'

import { dataRequestsQuery } from '@/api/admin'
import { DataRequestsPage } from '@/features/data-requests/data-requests-page'
import { dataRequestSearchSchema, toDataRequestFilters } from '@/features/data-requests/filters'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/data-requests')({
  validateSearch: dataRequestSearchSchema,
  staticData: { title: t.nav.dataRequests },
  loaderDeps: ({ search }) => toDataRequestFilters(search),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(dataRequestsQuery(deps))
  },
  component: DataRequestsRoute,
})

function DataRequestsRoute() {
  return <DataRequestsPage search={Route.useSearch()} />
}
