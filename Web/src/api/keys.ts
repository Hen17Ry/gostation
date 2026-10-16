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

/** Clés de l'administration : chaque liste porte ses filtres (curseur compris). */
export const counterKeys = { all: ['counters'] as const }

export const stationKeys = {
  all: ['stations'] as const,
  lists: () => [...stationKeys.all, 'list'] as const,
  list: (f: object) => [...stationKeys.lists(), f] as const,
  detail: (id: string) => [...stationKeys.all, 'detail', id] as const,
  timeline: (id: string) => [...stationKeys.all, 'timeline', id] as const,
  document: (id: string) => [...stationKeys.all, 'document', id] as const,
  map: () => [...stationKeys.all, 'map'] as const,
}

export const reportKeys = {
  all: ['reports'] as const,
  list: (f: object) => [...reportKeys.all, 'list', f] as const,
}

export const alertKeys = {
  all: ['alerts'] as const,
  list: (f: object) => [...alertKeys.all, 'list', f] as const,
}

export const userKeys = {
  all: ['users'] as const,
  list: (f: object) => [...userKeys.all, 'list', f] as const,
  detail: (id: string) => [...userKeys.all, 'detail', id] as const,
}

export const productKeys = { all: ['products'] as const }

export const auditKeys = {
  all: ['audit'] as const,
  list: (f: object) => [...auditKeys.all, 'list', f] as const,
}

export const exportKeys = {
  all: ['exports'] as const,
  list: (cursor: string | undefined) => [...exportKeys.all, 'list', cursor ?? null] as const,
}

export const dataRequestKeys = {
  all: ['dataRequests'] as const,
  lists: () => [...dataRequestKeys.all, 'list'] as const,
  list: (f: object) => [...dataRequestKeys.lists(), f] as const,
  detail: (id: string) => [...dataRequestKeys.all, 'detail', id] as const,
}

export const shortageKeys = {
  all: ['shortages'] as const,
  map: (f: object) => [...shortageKeys.all, f] as const,
}
