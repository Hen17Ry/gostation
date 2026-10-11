import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { session } from '@/api/client'

import { LoginPage } from './login-page'

type Handler = (req: Request) => Response | Promise<Response>

function stubApi(routes: Record<string, Handler>) {
  const calls: { path: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init)
      const path = new URL(req.url).pathname
      const text = req.method === 'GET' ? '' : await req.clone().text()
      calls.push({ path, body: text ? JSON.parse(text) : null })
      const handler = routes[path]
      return handler ? handler(req) : new Response(null, { status: 404 })
    }),
  )
  return calls
}

const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ type: `urn:gostation:problem:${code}`, title: 'x', status, code }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })

const profile = {
  id: '01929b3e-7c41-7d2a-9f1e-3b8c2d4a5e6f',
  email: 'awa@gostation.bj',
  firstName: 'Awa',
  lastName: 'Houngbo',
  role: 'admin',
  emailVerified: true,
  twoFactorEnabled: true,
  privacyPolicy: {
    acceptedVersion: '1.0',
    acceptedAt: '2026-10-01T08:00:00Z',
    currentVersion: '1.0',
    reacceptRequired: false,
  },
  station: null,
  createdAt: '2026-10-01T08:00:00Z',
}
const codes = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-DD${'234567AB'[i % 8]}${'CDEFGHIJKL'[i]}`)

function renderLogin() {
  const root = createRootRoute()
  const login = createRoute({
    getParentRoute: () => root,
    path: '/login',
    component: () => <LoginPage redirect="/stations" />,
  })
  const home = createRoute({ getParentRoute: () => root, path: '/stations', component: () => <p>Page des stations</p> })
  const router = createRouter({
    routeTree: root.addChildren([login, home]),
    history: createMemoryHistory({ initialEntries: ['/login'] }),
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, qc }
}

afterEach(() => {
  vi.unstubAllGlobals()
  session.clear()
})

describe('LoginPage', () => {
  it('compte désactivé : message dédié, mot de passe effacé', async () => {
    stubApi({ '/api/v1/auth/admin/login': () => problem(403, 'auth.account_disabled') })
    renderLogin()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Adresse email'), 'awa@gostation.bj')
    await user.type(screen.getByLabelText('Mot de passe'), 'Lagune-Cotonou-88')
    await user.click(screen.getByRole('button', { name: 'Continuer' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Compte désactivé')
    expect(alert).toHaveTextContent('Contactez un autre administrateur')
    expect(screen.getByLabelText('Mot de passe')).toHaveValue('')
  })

  it('identifiants invalides : message générique, jamais le détail anglais', async () => {
    stubApi({ '/api/v1/auth/admin/login': () => problem(401, 'auth.invalid_credentials') })
    renderLogin()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Adresse email'), 'awa@gostation.bj')
    await user.type(screen.getByLabelText('Mot de passe'), 'faux')
    await user.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email ou mot de passe incorrect.')
  })

  it('valide les champs avant tout appel', async () => {
    const calls = stubApi({})
    renderLogin()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Continuer' }))
    expect(await screen.findByText("Saisissez l'adresse email.")).toBeInTheDocument()
    expect(screen.getByText('Saisissez le mot de passe.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('première connexion : QR code, code TOTP, codes de secours à confirmer, puis page demandée', async () => {
    const calls = stubApi({
      '/api/v1/auth/admin/login': () =>
        Response.json({
          mfaToken: 'gsm_x',
          twoFactor: 'setup_required',
          expiresIn: 300,
          setup: {
            secret: 'JBSWY3DPEHPK3PXP',
            otpauthUri: 'otpauth://totp/GoStation:awa?secret=JBSWY3DPEHPK3PXP&issuer=GoStation',
          },
        }),
      '/api/v1/auth/admin/2fa': () =>
        Response.json({ user: profile, csrfToken: 'csrf-x', expiresIn: 900, recoveryCodes: codes }),
    })
    const { router } = renderLogin()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Adresse email'), 'awa@gostation.bj')
    await user.type(screen.getByLabelText('Mot de passe'), 'Lagune-Cotonou-88')
    await user.click(screen.getByRole('button', { name: 'Continuer' }))

    expect(await screen.findByRole('heading', { name: 'Activer la double authentification' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeInTheDocument()
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Code de vérification'), '123456')
    expect(await screen.findByRole('heading', { name: 'Vos codes de secours' })).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/api/v1/auth/admin/2fa')?.body).toEqual({ mfaToken: 'gsm_x', code: '123456' })
    expect(session.getCsrfToken()).toBe('csrf-x')
    expect(screen.getAllByRole('listitem').filter((li) => /^\d+\.[A-Z]{4}-/.test(li.textContent ?? ''))).toHaveLength(
      10,
    )

    const go = screen.getByRole('button', { name: 'Accéder au tableau de bord' })
    expect(go).toBeDisabled()
    await user.click(screen.getByLabelText("J'ai enregistré mes codes de secours en lieu sûr."))
    await user.click(go)
    await waitFor(() => expect(router.state.location.pathname).toBe('/stations'))
  })
})
