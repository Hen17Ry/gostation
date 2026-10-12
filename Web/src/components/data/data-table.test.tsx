import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DataTable } from './data-table'
import { columnHelper } from './table-features'

interface Row {
  id: string
  name: string
  city: string
}
const col = columnHelper<Row>()
const columns = [
  col.accessor('name', {
    header: 'Station',
    meta: { hideable: false },
    cell: (c) => (
      <button type="button" data-open-row>
        {c.getValue()}
      </button>
    ),
  }),
  col.accessor('city', { header: 'Ville', cell: (c) => <a href="#ville">{c.getValue()}</a> }),
]
const rows: Row[] = [
  { id: '1', name: 'Akpakpa', city: 'Cotonou' },
  { id: '2', name: 'Godomey', city: 'Abomey-Calavi' },
]

describe('DataTable', () => {
  it('lignes, ouverture au clic (sauf sur un lien), ligne sélectionnée', async () => {
    const onRowClick = vi.fn()
    const user = userEvent.setup()
    render(
      <DataTable
        caption="Stations"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        onRowClick={onRowClick}
        selectedId="2"
      />,
    )
    const table = screen.getByRole('table', { name: 'Stations' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Akpakpa' }))
    expect(onRowClick).toHaveBeenCalledWith(rows[0])
    await user.click(screen.getByRole('link', { name: 'Cotonou' }))
    expect(onRowClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Godomey' }).closest('tr')).toHaveAttribute('aria-selected', 'true')
  })

  it('état vide et squelettes', () => {
    const { rerender } = render(
      <DataTable caption="Stations" columns={columns} data={[]} getRowId={(r) => r.id} empty={<p>Aucune station</p>} />,
    )
    expect(screen.getByText('Aucune station')).toBeInTheDocument()
    rerender(<DataTable caption="Stations" columns={columns} data={[]} getRowId={(r) => r.id} isLoading />)
    expect(screen.getByText('Chargement des lignes')).toBeInTheDocument()
  })

  it('colonnes masquables, choix mémorisé par tableau', async () => {
    const user = userEvent.setup()
    render(<DataTable caption="Stations" columns={columns} data={rows} getRowId={(r) => r.id} storageKey="t" />)
    await user.click(screen.getByRole('button', { name: 'Colonnes' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Ville' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('columnheader', { name: 'Ville' })).toBeNull()
    expect(JSON.parse(localStorage.getItem('gs-cols:t')!)).toEqual({ city: false })
  })
})

describe('DataTable : menu d’actions par ligne', () => {
  it('menu nommé d’après la ligne, action exécutée sans ouvrir la ligne', async () => {
    const onRowClick = vi.fn()
    const copy = vi.fn()
    const user = userEvent.setup()
    render(
      <DataTable
        caption="Stations"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        onRowClick={onRowClick}
        rowLabel={(r) => r.name}
        rowActions={(r) => [{ label: 'Copier l’IFU', onSelect: () => copy(r.id) }]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Actions pour Godomey' }))
    await user.click(screen.getByRole('menuitem', { name: 'Copier l’IFU' }))
    expect(copy).toHaveBeenCalledWith('2')
    expect(onRowClick).not.toHaveBeenCalled()
  })
})
