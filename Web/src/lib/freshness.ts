import type { StationFreshness } from '@/api/admin-schemas'

const STALE_MS = 8 * 3600_000
const EXPIRED_MS = 24 * 3600_000

/** Fraîcheur d'une station d'après sa dernière saisie ou confirmation (même règle que l'API). */
export function freshnessOf(lastAt: string | null | undefined, now: number): StationFreshness {
  if (!lastAt) return 'none'
  const age = now - Date.parse(lastAt)
  return age < STALE_MS ? 'fresh' : age < EXPIRED_MS ? 'stale' : 'expired'
}
