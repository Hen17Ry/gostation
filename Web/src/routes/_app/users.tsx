import { createFileRoute } from '@tanstack/react-router'

import { usersQuery } from '@/api/admin'
import { toUserFilters, userSearchSchema } from '@/features/users/filters'
import { UsersPage } from '@/features/users/users-page'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/users')({
  validateSearch: userSearchSchema,
  staticData: { title: t.nav.users },
  loaderDeps: ({ search }) => toUserFilters(search),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(usersQuery(deps))
  },
  component: UsersRoute,
})

function UsersRoute() {
  return <UsersPage search={Route.useSearch()} />
}
