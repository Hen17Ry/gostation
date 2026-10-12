import { fireEvent, screen } from '@testing-library/react-native'

import { renderWithProviders } from '@/test/render'

import { Button } from './button'

describe('Button', () => {
  it('annonce l’état occupé et ignore les appuis pendant le chargement', async () => {
    const onPress = jest.fn()
    await renderWithProviders(<Button label="Rechercher" loading onPress={onPress} />)
    const button = screen.getByRole('button', { name: 'Rechercher' })
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true })
    await fireEvent.press(button)
    expect(onPress).not.toHaveBeenCalled()
  })
})
