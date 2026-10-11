import { createFileRoute } from '@tanstack/react-router'

import { ComingSoon } from '@/components/feedback/coming-soon'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/maps')({
  staticData: { title: t.nav.maps },
  component: () => <ComingSoon section={t.nav.maps} />,
})
