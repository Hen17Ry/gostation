import { useQuery } from '@tanstack/react-query'

import { dashboardQuery } from '@/api/queries'

import type { NavBadge } from './nav'

/** Compteurs « à traiter » de la navigation (instantanés, indépendants de la période). */
export function useNavBadges(): Partial<Record<NavBadge, number>> {
  const { data } = useQuery({
    ...dashboardQuery({ period: '7d' }),
    select: (d) => ({
      pending: d.stations.pendingApplications.count,
      reports: d.reports.open,
      alerts: d.alerts.open,
    }),
  })
  return data ?? {}
}
