import { fireEvent, screen } from '@testing-library/react-native'

import { renderWithProviders } from '@/test/render'

import { SwitchRow } from './list-row'

describe('SwitchRow', () => {
  // Régression : l'interrupteur natif restait une seconde cible, sans nom, à côté de la ligne.
  it('expose une seule cible « switch », nommée par son libellé', async () => {
    const onValueChange = jest.fn()
    await renderWithProviders(<SwitchRow title="Guidage vocal" value={false} onValueChange={onValueChange} />)
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(1)
    expect(switches[0]).toHaveAccessibleName('Guidage vocal')
    await fireEvent.press(switches[0])
    expect(onValueChange).toHaveBeenCalledWith(true)
  })
})
