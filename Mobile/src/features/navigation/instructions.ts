import osrmTextInstructions from 'osrm-text-instructions'

import type { RouteStep } from '@/api/schemas'
import { bearing } from '@/lib/bearing'
import { distanceM, type LatLng } from '@/lib/geo'

const compiler = osrmTextInstructions('v5')

/**
 * Texte français d'une étape (règle 11) : l'API renvoie des manœuvres structurées, le texte est
 * composé ici avec osrm-text-instructions. `departBearing` donne la direction du départ (« Se
 * diriger vers le nord »), absente des étapes de l'API.
 */
export function instructionText(step: RouteStep, opts: { departBearing?: number; destination?: string } = {}): string {
  return compiler.compile(
    'fr',
    {
      maneuver: {
        type: step.maneuver.type,
        modifier: step.maneuver.modifier,
        exit: step.maneuver.exit,
        bearing_after: step.maneuver.type === 'depart' ? opts.departBearing : undefined,
      },
      name: step.name,
      ref: step.ref,
      mode: 'driving',
      distance: step.distanceM,
    },
    { legCount: 1, legIndex: 0, waypointName: step.maneuver.type === 'arrive' ? opts.destination : undefined },
  )
}

/** Cap initial du tracé : premier point situé à plus de 10 m du départ. */
export function departBearing(line: LatLng[]): number | undefined {
  const start = line[0]
  if (!start) return undefined
  const next = line.find((p) => distanceM(start, p) > 10)
  return next ? bearing(start, next) : undefined
}

export type ManeuverIcon =
  | 'depart'
  | 'arrive'
  | 'straight'
  | 'left'
  | 'right'
  | 'slight-left'
  | 'slight-right'
  | 'sharp-left'
  | 'sharp-right'
  | 'uturn'
  | 'roundabout'

/** Pictogramme d'une manœuvre (type + direction OSRM). */
export function maneuverIcon(step: RouteStep): ManeuverIcon {
  const { type, modifier } = step.maneuver
  if (type === 'depart') return 'depart'
  if (type === 'arrive') return 'arrive'
  if (
    type === 'roundabout' ||
    type === 'rotary' ||
    type === 'roundabout turn' ||
    type === 'exit roundabout' ||
    type === 'exit rotary'
  )
    return 'roundabout'
  switch (modifier) {
    case 'left':
      return 'left'
    case 'right':
      return 'right'
    case 'slight left':
      return 'slight-left'
    case 'slight right':
      return 'slight-right'
    case 'sharp left':
      return 'sharp-left'
    case 'sharp right':
      return 'sharp-right'
    case 'uturn':
      return 'uturn'
    default:
      return 'straight'
  }
}
