import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import CommandMenu from './command-menu'

function renderMenu() {
  const root = createRootRoute({ component: () => <CommandMenu open onOpenChange={() => {}} /> })
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('CommandMenu', () => {
  beforeAll(() => {
    // cmdk fait défiler l'option active, ce que jsdom n'implémente pas.
    Element.prototype.scrollIntoView ??= () => {}
  })
  afterEach(() => vi.unstubAllGlobals())

  // Régression (E2E du staging) : l'indicateur « Recherche… » était rendu dans la listbox, qui ne
  // doit contenir que des options et des groupes (axe : aria-required-children).
  it('recherche en cours : statut annoncé hors de la liste des suggestions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    renderMenu()
    const status = await screen.findByRole('status')
    expect(status).toBeEmptyDOMElement()

    await userEvent.setup().type(screen.getByRole('combobox'), 'Station')
    await waitFor(() => expect(status).toHaveTextContent('Recherche…'))
    expect(screen.getByRole('listbox')).not.toContainElement(status)
  })
})
