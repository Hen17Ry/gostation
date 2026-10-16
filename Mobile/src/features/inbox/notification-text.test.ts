import { notificationText } from './notification-text'

describe('notificationText', () => {
  it('compose le texte d’après type et data, jamais d’un texte serveur', () => {
    expect(
      notificationText({
        type: 'back_in_stock',
        data: { stationId: 's1', stationName: 'Station Akpakpa', productLabel: 'Gaz 12,5 kg', text: 'IGNORÉ' },
      }),
    ).toBe('Gaz 12,5 kg est de retour en stock à Station Akpakpa.')
  })

  it('station_reported ne cite que la station', () => {
    const text = notificationText({
      type: 'station_reported',
      data: { stationName: 'Station X', reason: 'station_closed' },
    })
    expect(text).toBe('Des utilisateurs ont signalé un problème sur Station X.')
  })

  it('décision de l’admin : texte par décision, jamais le motif', () => {
    const text = (decision: string) =>
      notificationText({ type: 'station_decision', data: { stationName: 'Station Zongo', decision, reason: 'SECRET' } })
    expect(text('approved')).toBe(
      'Station Zongo est validée : renseignez vos stocks pour apparaître dans la recherche.',
    )
    expect(text('suspended')).toBe('Station Zongo est suspendue : consultez le motif.')
    expect(text('move_rejected')).toBe(
      'Le déplacement de Station Zongo a été refusé : l’ancienne position reste active.',
    )
    expect(text('bogus')).toBe('Nouvelle notification')
    expect(text('rejected')).not.toContain('SECRET')
  })
})
