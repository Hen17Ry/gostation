import type { PeriodSearch } from '@/features/dashboard/period'

/** Fabriques de query keys par domaine (CLAUDE.md, conventions TypeScript). */
export const authKeys = {
  all: ['auth'] as const,
  me: () => [...authKeys.all, 'me'] as const,
}

export const dashboardKeys = {
  all: ['dashboard'] as const,
  detail: (p: PeriodSearch) => [...dashboardKeys.all, p.period, p.from ?? null, p.to ?? null] as const,
}
