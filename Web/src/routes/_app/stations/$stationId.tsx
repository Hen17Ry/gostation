import { createFileRoute } from '@tanstack/react-router'

import { stationQuery, stationTimelineQuery } from '@/api/admin'
import { StationPage } from '@/features/stations/station-page'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/stations/$stationId')({
  staticData: { title: t.nav.stations },
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(stationQuery(params.stationId))
    void context.queryClient.prefetchQuery(stationTimelineQuery(params.stationId))
  },
  component: StationRoute,
})

function StationRoute() {
  const { stationId } = Route.useParams()
  return <StationPage id={stationId} />
}
