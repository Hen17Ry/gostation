import { fireEvent, screen } from '@testing-library/react-native'

import type { Product } from '@/api/schemas'
import { renderWithProviders } from '@/test/render'

import { ProductPicker, productLabel } from './product-picker'

const products: Product[] = [
  { id: 3, code: 'lpg_25', kind: 'lpg', unit: 'cylinder', sizeKg: 25, label: 'Gaz 25 kg' },
  { id: 1, code: 'lpg_6', kind: 'lpg', unit: 'cylinder', sizeKg: 6, label: 'Gaz 6 kg' },
  { id: 2, code: 'lpg_12_5', kind: 'lpg', unit: 'cylinder', sizeKg: 12.5, label: 'Gaz 12,5 kg' },
  { id: 4, code: 'petrol', kind: 'petrol', unit: 'liter', sizeKg: null, label: 'Essence' },
  { id: 5, code: 'diesel', kind: 'diesel', unit: 'liter', sizeKg: null, label: 'Gasoil' },
]

describe('ProductPicker', () => {
  it('montre les tailles de gaz du catalogue, triées', async () => {
    await renderWithProviders(<ProductPicker products={products} productId={2} onChange={jest.fn()} />)
    const sizes = screen.getAllByRole('radio').map((n) => n.props.accessibilityLabel)
    expect(sizes).toEqual(['Gaz, Bouteilles', 'Essence, Super', 'Gasoil, Gazole', '6 kg', '12,5 kg', '25 kg'])
    expect(screen.getByTestId('size-lpg_12_5').props.accessibilityState.selected).toBe(true)
  })

  it('choisir Essence sélectionne le produit et masque les tailles', async () => {
    const onChange = jest.fn()
    const { rerender } = await renderWithProviders(
      <ProductPicker products={products} productId={2} onChange={onChange} />,
    )
    await fireEvent.press(screen.getByTestId('kind-petrol'))
    expect(onChange).toHaveBeenCalledWith(4)
    await rerender(<ProductPicker products={products} productId={4} onChange={onChange} />)
    expect(screen.queryByText('6 kg')).toBeNull()
  })

  it('choisir Gaz prend la taille moyenne par défaut', async () => {
    const onChange = jest.fn()
    await renderWithProviders(<ProductPicker products={products} productId={4} onChange={onChange} />)
    await fireEvent.press(screen.getByTestId('kind-lpg'))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('libellés courts', async () => {
    expect(productLabel(products[2]!)).toBe('Gaz 12,5 kg')
    expect(productLabel({ sizeKg: null, label: 'Essence sans plomb' })).toBe('Essence sans plomb')
    expect(productLabel({ sizeKg: 6, label: 'x' })).toBe('Gaz 6 kg')
  })
})
