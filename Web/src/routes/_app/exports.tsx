import { createFileRoute } from '@tanstack/react-router'

import { ComingSoon } from '@/components/feedback/coming-soon'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/exports')({
  staticData: { title: t.nav.exports },
  component: () => <ComingSoon section={t.nav.exports} />,
})
