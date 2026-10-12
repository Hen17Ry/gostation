import { createFileRoute } from '@tanstack/react-router'

import { stationsQuery } from '@/api/admin'
import { StationsPage } from '@/features/stations/stations-page'
import { stationSearchSchema, toStationFilters } from '@/features/stations/search'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/stations/')({
  validateSearch: stationSearchSchema,
  staticData: { title: t.nav.stations },
  loaderDeps: ({ search }) => toStationFilters(search),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(stationsQuery(deps))
  },
  component: StationsRoute,
})

function StationsRoute() {
  return <StationsPage search={Route.useSearch()} />
}
