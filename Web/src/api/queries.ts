import { keepPreviousData, queryOptions } from '@tanstack/react-query'

import { toApiQuery, type PeriodSearch } from '@/features/dashboard/period'

import { api, unwrap } from './client'
import { authKeys, dashboardKeys } from './keys'
import { type Dashboard, profileSchema } from './schemas'

export const meQuery = queryOptions({
  queryKey: authKeys.me(),
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/me', { signal }), profileSchema),
  staleTime: 5 * 60_000,
  retry: false,
})

export const dashboardQuery = (p: PeriodSearch) =>
  queryOptions({
    queryKey: dashboardKeys.detail(p),
    queryFn: async ({ signal }): Promise<Dashboard> => {
      const { dashboardSchema } = await import('./dashboard-schema')
      return unwrap(api.GET('/api/v1/admin/dashboard', { params: { query: toApiQuery(p) }, signal }), dashboardSchema)
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  })
