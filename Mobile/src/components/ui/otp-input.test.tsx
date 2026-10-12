import { fireEvent, screen } from '@testing-library/react-native'
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
    expect(screen.getByText('4')).toBeOnTheScreen()
  })

  it('ne valide pas avant le 6ᵉ chiffre', async () => {
    const onComplete = jest.fn()
    await renderWithProviders(<Harness onComplete={onComplete} />)
    await fireEvent.changeText(screen.getByLabelText('Code de vérification'), '12345')
    expect(onComplete).not.toHaveBeenCalled()
  })
})
