import { fireEvent, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { useState } from 'react'

import { renderWithProviders } from '@/test/render'

import { OtpInput } from './otp-input'

function Harness({ onComplete }: { onComplete: (c: string) => void }) {
  const [code, setCode] = useState('')
  return (
    <OtpInput label="Code de vérification" value={code} onChange={setCode} onComplete={onComplete} autoFocus={false} />
  )
}

describe('OtpInput', () => {
  it('accepte un code collé (saisie automatique) et garde les chiffres', async () => {
    const onComplete = jest.fn()
    await renderWithProviders(<Harness onComplete={onComplete} />)
    await fireEvent.changeText(screen.getByLabelText('Code de vérification'), ' 12-34 56 ')
    expect(onComplete).toHaveBeenCalledWith('123456')
    expect(screen.getByText('4', { includeHiddenElements: true })).toBeTruthy()
  })

  it('ne valide pas avant le 6ᵉ chiffre', async () => {
    const onComplete = jest.fn()
    await renderWithProviders(<Harness onComplete={onComplete} />)
    await fireEvent.changeText(screen.getByLabelText('Code de vérification'), '12345')
    expect(onComplete).not.toHaveBeenCalled()
  })

  // Régression : le champ invisible faisait 1 × 1 px, à côté d'une rangée de cases cliquable mais
  // sans nom ; les lecteurs d'écran ne trouvaient pas la cible à l'exploration au toucher.
  it('pose le champ nommé sur toute la rangée de cases, chiffres annoncés par lui seul', async () => {
    await renderWithProviders(<Harness onComplete={jest.fn()} />)
    const input = screen.getByLabelText('Code de vérification')
    expect(StyleSheet.flatten(input.props.style)).toMatchObject({
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    })
    await fireEvent.changeText(input, '1234')
    expect(screen.queryByText('4')).toBeNull()
    expect(screen.getByText('4', { includeHiddenElements: true })).toBeTruthy()
  })
})
