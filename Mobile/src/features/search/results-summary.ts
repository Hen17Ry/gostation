import type { SearchResult } from '@/api/schemas'
import { t } from '@/i18n'
import { APPROX, formatDistance } from '@/lib/format'

/**
 * Sous-titre du panneau de résultats : « 4 stations · la plus proche à 590 m ». La distance est
 * celle des cartes (routière, sinon à vol d'oiseau, précédée de ≈ comme sur les cartes). Le rayon de
 * recherche ne convient pas : compté à vol d'oiseau et élargi du rayon de la cellule du cache, il
 * ne dit pas où sont les stations.
 */
export function resultsSummary(results: readonly SearchResult[], approximate = false): string {
  if (results.length === 0) return t.search.results(0)
  const nearest = results.reduce((best, r) =>
    (r.routeDistanceM ?? r.distanceM) < (best.routeDistanceM ?? best.distanceM) ? r : best,
  )
  const estimated = approximate || nearest.routeDistanceM === null ? APPROX : ''
  const distance = `${estimated}${formatDistance(nearest.routeDistanceM ?? nearest.distanceM)}`
  return `${t.search.results(results.length)} · ${t.search.nearest(distance)}`
}
