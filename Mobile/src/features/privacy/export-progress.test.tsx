import { fireEvent, screen, waitFor } from '@testing-library/react-native'

import MyData from '@/app/profile/data'
import { t } from '@/i18n'
import { useAuth } from '@/stores/auth'
import { renderWithProviders } from '@/test/render'

import { shareDataExport } from './share-export'

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }))
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
)
jest.mock('./share-export', () => ({ shareDataExport: jest.fn(async () => true) }))
jest.mock('@/lib/navigation', () => ({ useCloseFlow: () => jest.fn() }))

// L'écran interroge le serveur toutes les 3 s tant que la copie est en préparation : horloge
// simulée pour tout le fichier, avancée par waitFor, au lieu d'attendre 3 s réelles (ce test
// dépassait son délai sous charge). Activée avant le premier rendu et jamais rendue : les modules
// qui retiennent les fonctions de minuterie à leur chargement voient toujours la même horloge.
jest.useFakeTimers()

const created = '2026-10-16T09:00:00Z'
const LINK = '/api/v1/me/data-export/0199/download?expires=1&signature=abc'
let exportState: Record<string, unknown>
const calls: string[] = []

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  })

beforeEach(() => {
  calls.length = 0
  exportState = { status: 'none', createdAt: null, expiresAt: null, sizeBytes: null, downloadUrl: null }
  useAuth.setState({ status: 'signedIn' })
  globalThis.fetch = jest.fn(async (req: Request) => {
    const path = new URL(req.url).pathname
    calls.push(`${req.method} ${path}`)
    if (path === '/api/v1/me/data-export' && req.method === 'POST') {
      exportState = { ...exportState, status: 'pending', createdAt: created }
      return json(202, exportState)
    }
    if (path === '/api/v1/me/data-export') return json(200, exportState)
    if (path === '/api/v1/me/data-requests') return json(200, { items: [] })
    return json(404, { status: 404, code: 'route.not_found' })
  }) as typeof fetch
})

afterEach(() => useAuth.setState({ status: 'unknown' }))

it('prépare la copie, en suit la génération, puis la partage', async () => {
  await renderWithProviders(<MyData />)
  fireEvent.press(await screen.findByText(t.privacy.exportPrepare))
  expect(await screen.findByText(t.privacy.exportPreparing)).toBeTruthy()
  expect(calls).toContain('POST /api/v1/me/data-export')

  exportState = {
    status: 'ready',
    createdAt: created,
    expiresAt: '2026-10-17T09:00:00Z',
    sizeBytes: 2048,
    downloadUrl: LINK,
  }
  // 3 s simulées : le suivi relit l'état et propose le partage.
  fireEvent.press(await screen.findByText(t.privacy.exportShare, {}, { timeout: 6_000 }))
  await waitFor(() => expect(shareDataExport).toHaveBeenCalledWith(LINK, created))
  expect(calls.filter((c) => c === 'GET /api/v1/me/data-export').length).toBeGreaterThanOrEqual(2)
})
