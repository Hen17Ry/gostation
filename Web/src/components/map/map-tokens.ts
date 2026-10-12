/**
 * Couleurs des cartes (tokens) et catégories des stations, sans dépendance à MapLibre : les
 * légendes les importent sans charger la bibliothèque cartographique.
 */
import type { StationMap } from '@/api/admin-schemas'

/** Catégorie de couleur d'une station : fraîcheur pour les approuvées, statut sinon. */
export type MapCategory = 'fresh' | 'stale' | 'expired' | 'pending' | 'suspended'
export const mapCategory = (p: StationMap['features'][number]['properties']): MapCategory =>
  p.status === 'approved'
    ? p.freshness === 'fresh'
      ? 'fresh'
      : p.freshness === 'stale'
        ? 'stale'
        : 'expired'
    : p.status === 'pending'
      ? 'pending'
      : 'suspended'

export const CATEGORY_TOKENS: Record<MapCategory, [string, string]> = {
  fresh: ['--status-good', '#0ca30c'],
  stale: ['--status-warning', '#fab219'],
  expired: ['--status-critical', '#d03b3b'],
  pending: ['--info', '#2a78d6'],
  suspended: ['--color-neutral-500', '#78726e'],
}

/** Dégradé séquentiel (une teinte, du clair au foncé) : orange → rouge braise (tokens de marque). */
export const RATE_STOPS: Array<[number, string, string]> = [
  [0, '--color-brand-200', '#ffd7a8'],
  [0.25, '--color-brand-400', '#ff9036'],
  [0.5, '--color-brand-600', '#d14200'],
  [0.75, '--color-brand-800', '#912d0f'],
  [1, '--color-brand-950', '#411307'],
]
