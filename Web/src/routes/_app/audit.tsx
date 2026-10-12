import { createFileRoute } from '@tanstack/react-router'

import { auditQuery } from '@/api/admin'
import { AuditPage } from '@/features/audit/audit-page'
import { auditSearchSchema, toAuditFilters } from '@/features/audit/filters'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/audit')({
  validateSearch: auditSearchSchema,
  staticData: { title: t.nav.audit },
  loaderDeps: ({ search }) => toAuditFilters(search),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(auditQuery(deps))
  },
  component: AuditRoute,
})

function AuditRoute() {
  return <AuditPage search={Route.useSearch()} />
}
