import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { formatInteger, formatPercent } from '@/lib/format'

import { KpiCard } from './kpi-card'

describe('KpiCard', () => {
  it('une hausse est favorable quand « up » est le bon sens', () => {
    render(
      <KpiCard label="Recherches" kpi={{ value: 278327, previous: 269000, change: 0.0347 }} format={formatInteger} />,
    )
    expect(screen.getByText('278 327')).toBeInTheDocument()
    const delta = screen.getByText(/en hausse de/).parentElement!
    expect(delta).toHaveTextContent('3,5 %')
    expect(delta.className).toContain('bg-success-subtle')
  })

  it('une hausse est défavorable pour un taux d’échec', () => {
    render(
      <KpiCard
        label="Sans station à 5 km"
        kpi={{ value: 0.14, previous: 0.1, change: 0.4 }}
        format={formatPercent}
        good="down"
      />,
    )
    expect(screen.getByText(/en hausse de/).parentElement!.className).toContain('bg-danger-subtle')
  })

  it('sans période de référence, pas d’évolution inventée', () => {
    render(<KpiCard label="Nouveaux gérants" kpi={{ value: 2, previous: 0, change: null }} format={formatInteger} />)
    expect(screen.getByText('pas de référence')).toBeInTheDocument()
    expect(screen.queryByText(/en hausse|en baisse/)).toBeNull()
  })
})
