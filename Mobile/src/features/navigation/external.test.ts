import { externalNavigationUrl } from './external'

describe('externalNavigationUrl', () => {
  const station = { lat: 6.3654, lng: 2.4183 }

  it('Android : intent geo: avec le nom de la station', () => {
    expect(externalNavigationUrl(station, 'Station Akpakpa', 'android')).toBe(
      'geo:6.3654,2.4183?q=6.3654,2.4183(Station%20Akpakpa)',
    )
  })

  it('iOS : Apple Plans', () => {
    expect(externalNavigationUrl(station, 'Station', 'ios')).toBe(
      'https://maps.apple.com/?daddr=6.3654,2.4183&q=Station',
    )
  })
})
