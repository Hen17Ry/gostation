import { createFileRoute } from '@tanstack/react-router'

import { ComingSoon } from '@/components/feedback/coming-soon'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/catalog')({
  staticData: { title: t.nav.catalog },
  component: () => <ComingSoon section={t.nav.catalog} />,
})
