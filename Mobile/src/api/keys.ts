/**
 * Fabriques de clés TanStack Query, par domaine. Seules les clés `public` (catalogue, fiches de
 * stations) sont persistées dans MMKV ; recherche et itinéraire ne sont jamais persistés (ils
 * dépendent de la position) et les données du compte restent en mémoire.
 */
export const productKeys = {
  all: ['public', 'products'] as const,
}

export const stationKeys = {
  all: ['public', 'stations'] as const,
  detail: (id: string) => ['public', 'stations', id] as const,
}

export const searchKeys = {
  all: ['search'] as const,
}

export const routeKeys = {
  all: ['route'] as const,
}

export const meKeys = {
  all: ['me'] as const,
  profile: () => ['me', 'profile'] as const,
  sessions: () => ['me', 'sessions'] as const,
  favorites: () => ['me', 'favorites'] as const,
  notifications: () => ['me', 'notifications'] as const,
  settings: () => ['me', 'notification-settings'] as const,
}

/** Préfixe des requêtes dont le cache peut être écrit dans MMKV (données publiques). */
export const PERSISTED_PREFIX = 'public'
