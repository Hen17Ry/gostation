import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { IfuValue } from './station-sections'

function renderIfu(sharedCount: number) {
  const root = createRootRoute({ component: () => <IfuValue ifu="3201234567890" sharedCount={sharedCount} /> })
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) })
  return render(<RouterProvider router={router} />)
}

describe('IfuValue', () => {
  it('shows the IFU alone when no other station declares it', async () => {
    renderIfu(0)
    expect(await screen.findByText('3201234567890')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('links to every station declaring the same IFU', async () => {
    renderIfu(2)
    const link = await screen.findByRole('link', { name: 'IFU déjà utilisé par 2 stations' })
    const url = new URL(link.getAttribute('href') ?? '', 'http://admin.test')
    expect(url.pathname).toBe('/stations')
    expect(url.searchParams.get('status')).toBe('all')
    // Valeurs de recherche en JSON (sérialisation du routeur) : l'IFU, tout en chiffres, reste une chaîne.
    expect(JSON.parse(url.searchParams.get('q') ?? 'null')).toBe('3201234567890')
  })

  it('uses the singular for one other station', async () => {
    renderIfu(1)
    expect(await screen.findByRole('link', { name: 'IFU déjà utilisé par 1 station' })).toBeInTheDocument()
  })
})
