import { createFileRoute } from '@tanstack/react-router'

import { ComingSoon } from '@/components/feedback/coming-soon'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/audit')({
  staticData: { title: t.nav.audit },
  component: () => <ComingSoon section={t.nav.audit} />,
})
