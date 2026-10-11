import { createFileRoute } from '@tanstack/react-router'

import { ComingSoon } from '@/components/feedback/coming-soon'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/users')({
  staticData: { title: t.nav.users },
  component: () => <ComingSoon section={t.nav.users} />,
})
