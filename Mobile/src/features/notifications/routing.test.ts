import { notificationHref, pushData } from './routing'

describe('liens des notifications (D61)', () => {
  it('rappel de stock : écran Stocks', () => {
    expect(notificationHref({ type: 'stock_reminder', stationId: 's1' })).toBe('/manager/stocks')
  })

  it('seuil de signalements : Signalements du gérant', () => {
    expect(notificationHref({ type: 'station_reported', stationId: 's1' })).toBe('/manager/reports')
  })

  it('retour en stock : page de la station, ou les favoris sans station', () => {
    expect(notificationHref({ type: 'back_in_stock', stationId: 's1' })).toEqual({
      pathname: '/station/[id]',
      params: { id: 's1' },
    })
    expect(notificationHref({ type: 'back_in_stock' })).toBe('/favorites')
  })

  it.each([
    ['rejected', '/manager/status'],
    ['suspended', '/manager/status'],
    ['approved', '/manager/station'],
    ['reinstated', '/manager/station'],
    ['move_approved', '/manager/station'],
    ['move_rejected', '/manager/station'],
  ])('décision « %s » : %s', (decision, href) => {
    expect(notificationHref({ type: 'station_decision', decision })).toBe(href)
  })

  it('type inconnu, confirmation locale ou données absentes : aucun écran', () => {
    expect(notificationHref({ type: 'promo' })).toBeNull()
    expect(notificationHref({ local: 'confirmation' })).toBeNull()
    expect(notificationHref(null)).toBeNull()
  })
})

describe('données d’un push', () => {
  it('lit `data`, puis `dataString` en JSON', () => {
    expect(pushData({ data: { type: 'stock_reminder' } })).toEqual({ type: 'stock_reminder' })
    expect(pushData({ dataString: '{"type":"back_in_stock","stationId":"s1"}' })).toEqual({
      type: 'back_in_stock',
      stationId: 's1',
    })
  })

  it('charge utile absente ou illisible : objet vide', () => {
    expect(pushData({ dataString: '{oops' })).toEqual({})
    expect(pushData({ data: null })).toEqual({})
    expect(pushData(undefined)).toEqual({})
  })
})
