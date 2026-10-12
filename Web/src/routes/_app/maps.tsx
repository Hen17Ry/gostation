import { createFileRoute } from '@tanstack/react-router'

import { MapsPage } from '@/features/maps/maps-page'
import { mapsSearchSchema } from '@/features/maps/search'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/maps')({
  validateSearch: mapsSearchSchema,
  staticData: { title: t.nav.maps },
  component: MapsRoute,
})

function MapsRoute() {
  return <MapsPage search={Route.useSearch()} />
}
