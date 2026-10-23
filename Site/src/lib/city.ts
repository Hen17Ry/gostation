/**
 * Données de la ville partagées par la carte, l'écran du téléphone et les scènes : la version légère
 * (stations, trajets), sans la géométrie du fond de carte qui ne sert qu'au build (lib/map-svg.ts).
 */
import city from '@/data/city-points.json'

export { city }

export type Station = (typeof city.stations)[number]

/** Les stations en stock à moins de 2 km, par temps de trajet : le classement de l'app. */
export const results: Station[] = city.stations
  .filter((s) => s.status === 'stock' && s.distanceM <= 2000)
  .sort((a, b) => (a.durationS ?? 0) - (b.durationS ?? 0))

export const target: Station = city.stations.find((s) => s.id === city.target)!

/** Mètres → unités de la carte. */
export const toUnits = (meters: number) => meters / city.metersPerUnit
