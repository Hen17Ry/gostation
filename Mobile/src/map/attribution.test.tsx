import { fireEvent, screen } from '@testing-library/react-native'
import * as Linking from 'expo-linking'

import { t } from '@/i18n'
import { renderWithProviders } from '@/test/render'

import { MapAttribution } from './attribution'

jest.mock('@gorhom/bottom-sheet', () => jest.requireActual('@gorhom/bottom-sheet/mock'))
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
)
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }))

describe('MapAttribution', () => {
  it('affiche les crédits OpenStreetMap et OpenFreeMap, nommés pour les lecteurs d’écran', async () => {
    await renderWithProviders(<MapAttribution />)
    expect(screen.getByText('© OpenStreetMap · OpenFreeMap')).toBeTruthy()
    expect(screen.getByRole('button', { name: t.map.attributionLabel })).toBeTruthy()
  })

  it('ouvre la page de licence d’OpenStreetMap depuis les sources', async () => {
    await renderWithProviders(<MapAttribution />)
    await fireEvent.press(screen.getByRole('button', { name: `${t.map.osm}, ${t.map.osmHint}` }))
    expect(Linking.openURL).toHaveBeenCalledWith('https://www.openstreetmap.org/copyright')
  })
})
