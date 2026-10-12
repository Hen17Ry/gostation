import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod/mini'

import { exportsQuery } from '@/api/admin'
import { ExportsPage } from '@/features/exports/exports-page'
import { t } from '@/i18n'

const exportSearchSchema = z.object({ cursor: z.catch(z.optional(z.string()), undefined) })

export const Route = createFileRoute('/_app/exports')({
  validateSearch: exportSearchSchema,
  staticData: { title: t.nav.exports },
  loaderDeps: ({ search }) => ({ cursor: search.cursor }),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(exportsQuery(deps.cursor))
  },
  component: ExportsRoute,
})

function ExportsRoute() {
  return <ExportsPage cursor={Route.useSearch().cursor} />
}
