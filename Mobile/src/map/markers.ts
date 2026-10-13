import type { ExpressionSpecification, GeoJSONSourceSpecification } from '@maplibre/maplibre-gl-style-spec'

/**
 * Marqueurs des résultats. Un groupe de stations proches ne montre pas son nombre de stations : « 2 »
 * se lirait « station n° 2 » à côté des rangs de la liste. Il s'affiche en pile de pastilles, celle
 * du dessus portant le meilleur rang du groupe, avec l'état (ouverte ou fermée) de cette station.
 *
 * Rang et état voyagent ensemble dans `key = rang × 2 + (fermée ? 1 : 0)` : le minimum des clés d'un
 * groupe désigne sa meilleure station, sans perdre son état.
 */
export function markerKey(rank: number, open: boolean): number {
  return rank * 2 + (open ? 0 : 1)
}

export const clusterProperties = {
  best: ['min', ['get', 'key']],
} satisfies GeoJSONSourceSpecification['clusterProperties']

const cluster: ExpressionSpecification = ['has', 'point_count']

/** Rang affiché : celui de la station, ou celui de la meilleure station du groupe. */
export const markerRank: ExpressionSpecification = [
  'to-string',
  ['case', cluster, ['floor', ['/', ['get', 'best'], 2]], ['get', 'rank']],
]

/** Station (ou meilleure station du groupe) ouverte. */
export const markerOpen: ExpressionSpecification = [
  'case',
  cluster,
  ['==', ['%', ['get', 'best'], 2], 0],
  ['==', ['get', 'open'], 1],
]
