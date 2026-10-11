import { createFileRoute } from '@tanstack/react-router'

import { ComingSoon } from '@/components/feedback/coming-soon'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/reports')({
  staticData: { title: t.nav.reports },
  component: () => <ComingSoon section={t.nav.reports} />,
})
