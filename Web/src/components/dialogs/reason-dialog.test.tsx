import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'

import { ReasonDialog } from './reason-dialog'

function setup(onConfirm: (r: string) => Promise<unknown>, onOpenChange = vi.fn()) {
  render(
    <ReasonDialog
      open
      onOpenChange={onOpenChange}
      title="Suspendre la station"
      description="La station disparaît de la recherche."
      confirmLabel="Suspendre"
      onConfirm={onConfirm}
      destructive
    />,
  )
  return { onOpenChange, user: userEvent.setup() }
}

describe('ReasonDialog', () => {
  it('motif obligatoire : pas d’appel tant qu’il fait moins de 3 caractères', async () => {
    const onConfirm = vi.fn(() => Promise.resolve())
    const { user } = setup(onConfirm)
    await user.click(screen.getByRole('button', { name: 'Suspendre' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Saisissez un motif')
    expect(screen.getByLabelText('Motif')).toHaveAttribute('aria-invalid', 'true')
  })

  it('erreur de l’API affichée dans le dialogue, saisie conservée ; succès : fermeture', async () => {
    const onConfirm = vi
      .fn<(r: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new ApiError({ status: 409, code: 'station.invalid_status_transition' }))
      .mockResolvedValueOnce(undefined)
    const { user, onOpenChange } = setup(onConfirm)
    await user.type(screen.getByLabelText('Motif'), '  Stocks fictifs signalés  ')
    await user.click(screen.getByRole('button', { name: 'Suspendre' }))
    expect(onConfirm).toHaveBeenCalledWith('Stocks fictifs signalés')
    expect(await screen.findByText(/statut de la station a changé/)).toBeInTheDocument()
    expect(screen.getByLabelText('Motif')).toHaveValue('  Stocks fictifs signalés  ')
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Suspendre' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
