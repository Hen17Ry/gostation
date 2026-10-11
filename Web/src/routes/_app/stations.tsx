import { createFileRoute } from '@tanstack/react-router'

import { ComingSoon } from '@/components/feedback/coming-soon'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/stations')({
  staticData: { title: t.nav.stations },
  component: () => <ComingSoon section={t.nav.stations} />,
})
