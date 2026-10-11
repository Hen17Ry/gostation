import { createFileRoute } from '@tanstack/react-router'

import { ComingSoon } from '@/components/feedback/coming-soon'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/alerts')({
  staticData: { title: t.nav.alerts },
  component: () => <ComingSoon section={t.nav.alerts} />,
})
