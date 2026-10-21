import { screen, waitFor } from '@testing-library/react-native'

import MyData from '@/app/profile/data'
import DeleteAccount from '@/app/profile/delete'
import { t } from '@/i18n'
import { useAuth } from '@/stores/auth'
import { renderWithProviders } from '@/test/render'

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }))
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
)
jest.mock('@/lib/navigation', () => ({ useCloseFlow: () => jest.fn() }))

const created = '2026-10-16T09:00:00Z'
let exportState: Record<string, unknown>
let role: 'user' | 'manager'
const calls: string[] = []

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
  })

beforeEach(() => {
  calls.length = 0
  role = 'user'
  exportState = { status: 'none', createdAt: null, expiresAt: null, sizeBytes: null, downloadUrl: null }
  useAuth.setState({ status: 'signedIn' })
  globalThis.fetch = jest.fn(async (req: Request) => {
    const path = new URL(req.url).pathname
    calls.push(`${req.method} ${path}`)
    if (path === '/api/v1/me/data-export') return json(200, exportState)
    if (path === '/api/v1/me/data-requests') {
      return json(200, {
        items: [
          {
            id: 'r1',
            reference: 'DR-1A2B3C4D',
            type: 'rectification',
            status: 'completed',
            source: 'app',
            createdAt: created,
            dueAt: '2026-11-15T09:00:00Z',
            completedAt: '2026-10-17T09:00:00Z',
            response: 'Votre nom a été corrigé.',
          },
          {
            id: 'r2',
            reference: 'DR-5E6F7A8B',
            type: 'opposition',
            status: 'pending',
            source: 'email',
            createdAt: created,
            dueAt: '2026-11-15T09:00:00Z',
            completedAt: null,
            response: null,
          },
        ],
      })
    }
    if (path === '/api/v1/me') {
      return json(200, {
        id: 'u1',
        email: 'kofi@example.bj',
        firstName: 'Kofi',
        lastName: 'Mensah',
        role,
        emailVerified: true,
        twoFactorEnabled: false,
        privacyPolicy: { acceptedVersion: '1.0', acceptedAt: created, currentVersion: '1.0', reacceptRequired: false },
        station:
          role === 'manager' ? { id: 's1', name: 'Station Akpakpa', status: 'approved', statusReason: null } : null,
        createdAt: created,
      })
    }
    return json(404, { status: 404, code: 'route.not_found' })
  }) as typeof fetch
})

afterEach(() => useAuth.setState({ status: 'unknown' }))

describe('Mes données', () => {
  it('liste les demandes avec leur statut, l’échéance ou la réponse', async () => {
    await renderWithProviders(<MyData />)
    expect(await screen.findByText(/DR-1A2B3C4D/)).toBeTruthy()
    expect(screen.getByText('Traitée')).toBeTruthy()
    expect(screen.getByText('Votre nom a été corrigé.')).toBeTruthy()
    expect(screen.getByText('Reçue')).toBeTruthy()
    expect(screen.getByText(/Réponse au plus tard le/)).toBeTruthy()
  })
})

describe('Supprimer mon compte', () => {
  it('explique ce qui est supprimé et conservé', async () => {
    await renderWithProviders(<DeleteAccount />)
    expect(screen.getByText(t.privacy.deletedNow)).toBeTruthy()
    expect(screen.getByText(t.privacy.keptTitle)).toBeTruthy()
    await waitFor(() => expect(calls).toContain('GET /api/v1/me'))
    expect(screen.queryByText(t.privacy.managerTitle)).toBeNull()
  })

  it('ajoute, pour un gérant, ce que devient sa station', async () => {
    role = 'manager'
    await renderWithProviders(<DeleteAccount />)
    expect(await screen.findByText(t.privacy.managerTitle)).toBeTruthy()
    expect(screen.getByText(t.privacy.managerList[0]!)).toBeTruthy()
  })
})
