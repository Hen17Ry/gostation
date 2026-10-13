import { notificationStationId, notificationText } from './notification-text'

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

  it('identifiant de station facultatif', () => {
    expect(notificationStationId({ data: { stationId: 'abc' } })).toBe('abc')
    expect(notificationStationId({ data: {} })).toBeNull()
  })
})
