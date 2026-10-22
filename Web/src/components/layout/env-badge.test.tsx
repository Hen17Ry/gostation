import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { pageTitle } from '@/lib/app-env'

import { EnvBadge, EnvRibbon } from './env-badge'

describe('environnement', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('staging : badge lisible par les lecteurs d’écran, liseré, titre préfixé', () => {
    vi.stubEnv('VITE_APP_ENV', 'staging')
    const { container } = render(
      <>
        <EnvRibbon />
        <EnvBadge />
      </>,
    )
    expect(screen.getByText('Staging')).toBeVisible()
    expect(screen.getByText(/environnement de test, données fictives/)).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden].fixed')).not.toBeNull()
    expect(pageTitle('Stations · GoStation')).toBe('Staging · Stations · GoStation')
  })

  it('production : rien n’est affiché, titre inchangé', () => {
    vi.stubEnv('VITE_APP_ENV', 'production')
    const { container } = render(
      <>
        <EnvRibbon />
        <EnvBadge />
      </>,
    )
    expect(container).toBeEmptyDOMElement()
    expect(pageTitle('Stations · GoStation')).toBe('Stations · GoStation')
  })
})
