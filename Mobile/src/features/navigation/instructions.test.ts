import type { RouteStep } from '@/api/schemas'

import { departBearing, instructionText, maneuverIcon } from './instructions'

const step = (type: string, extra: Partial<RouteStep['maneuver']> = {}, name = ''): RouteStep => ({
  maneuver: { type, location: { lat: 6.37, lng: 2.4 }, ...extra },
  name,
  distanceM: 100,
  durationS: 10,
})

describe('instructionText (osrm-text-instructions, fr)', () => {
  it('compose le départ avec la direction calculée sur le tracé', () => {
    const bearing = departBearing([
      { lat: 6.37, lng: 2.4 },
      { lat: 6.38, lng: 2.4 },
    ])
    expect(instructionText(step('depart', {}, 'Boulevard de la Marina'), { departBearing: bearing })).toBe(
      'Se diriger vers le nord sur le boulevard de la Marina',
    )
  })

  it('traduit virages, giratoires et arrivée', () => {
    expect(instructionText(step('turn', { modifier: 'left' }, 'Rue 12.054'))).toBe('Tourner à gauche sur la rue 12.054')
    expect(instructionText(step('roundabout', { modifier: 'right', exit: 2 }, 'Avenue Steinmetz'))).toBe(
      'Prendre le giratoire et prendre la seconde sortie sur l’avenue Steinmetz',
    )
    expect(instructionText(step('arrive', { modifier: 'right' }), { destination: 'Station Akpakpa' })).toBe(
      'Vous êtes arrivé à Station Akpakpa, sur la droite',
    )
  })
})

describe('maneuverIcon', () => {
  it('associe type et direction à un pictogramme', () => {
    expect(maneuverIcon(step('turn', { modifier: 'sharp right' }))).toBe('sharp-right')
    expect(maneuverIcon(step('rotary', { modifier: 'left' }))).toBe('roundabout')
    expect(maneuverIcon(step('new name', { modifier: 'straight' }))).toBe('straight')
    expect(maneuverIcon(step('arrive'))).toBe('arrive')
  })
})
