import { useQuery } from '@tanstack/react-query'

import { countersQuery } from '@/api/counters'

import type { NavBadge } from './nav'

/** Compteurs « à traiter » de la navigation, rafraîchis toutes les 60 s (GET /admin/counters). */
export function useNavBadges(): Partial<Record<NavBadge, number>> {
  const { data } = useQuery({
    ...countersQuery,
    select: (c) => ({ pending: c.pendingStations, reports: c.openReports, alerts: c.openAlerts + c.locationReviews }),
  })
  return data ?? {}
}
