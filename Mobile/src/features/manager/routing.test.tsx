import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { act, renderRouter, screen } from 'expo-router/testing-library'
import type { ReactNode } from 'react'
import { Text } from 'react-native'

import { meKeys } from '@/api/keys'
import type { Profile } from '@/api/schemas'
import TabsLayout from '@/app/(tabs)/_layout'
import ManagerLayout from '@/app/manager/_layout'
import { useAuth } from '@/stores/auth'
import { usePrefs } from '@/stores/prefs'
import { ThemeProvider } from '@/theme/theme'

const profile = (status: 'pending' | 'approved' | 'rejected' | 'suspended'): Profile => ({
  id: 'u1',
  email: 'gerant@example.bj',
  firstName: 'Bio',
  lastName: 'Tchané',
  role: 'manager',
  emailVerified: true,
  twoFactorEnabled: false,
  privacyPolicy: {
    acceptedVersion: '1.0',
    acceptedAt: '2026-10-13T08:00:00Z',
    currentVersion: '1.0',
    reacceptRequired: false,
  },
  station: {
    id: 's1',
    name: 'Station Zongo',
    status,
    statusReason: status === 'rejected' ? 'Justificatif illisible' : null,
  },
  createdAt: '2026-10-13T08:00:00Z',
})

const page = (label: string) =>
  function Page() {
    return <Text>{label}</Text>
  }
// Recherche de l'espace utilisateur (carte et tuiles) : jamais rendue pour un gérant.
const searchRendered = jest.fn()
function SearchPage() {
  searchRendered()
  return <Text>écran recherche utilisateur</Text>
}
const routes = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': SearchPage,
  'manager/_layout': ManagerLayout,
  'manager/(tabs)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  'manager/(tabs)/stocks': page('écran stocks'),
  'manager/(tabs)/reports': page('écran signalements'),
  'manager/status': page('écran statut'),
  'manager/edit': page('écran correction'),
  'manager/resubmit': page('écran justificatif'),
  'manager/location': page('écran position'),
  'manager/hours': page('écran horaires'),
  'manager/products': page('écran produits'),
  'manager/search': page('écran recherche'),
}

function open(status: Parameters<typeof profile>[0], url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(meKeys.profile(), profile(status))
  useAuth.setState({ status: 'signedIn' })
  // Comme après une connexion (useLeaveAuth) : l'espace est déjà mémorisé.
  usePrefs.getState().setSpace({ role: 'manager', stationStatus: status })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  )
  return renderRouter(routes, { initialUrl: url, wrapper })
}

/** Rend le routeur sur `url` pour un gérant au statut donné ; renvoie le chemin affiché. */
async function pathFor(status: Parameters<typeof profile>[0], url: string) {
  const r = open(status, url)
  await r
  // Laisse finir les mises à jour de navigation qui suivent le premier rendu.
  await act(async () => {})
  return r.getPathname()
}

describe('espace gérant : écrans selon le statut de la station (D58, D61)', () => {
  // Remise à zéro avant le rendu (après, l'écran encore monté recevrait la mise à jour hors act).
  beforeEach(() => {
    useAuth.setState({ status: 'unknown' })
    usePrefs.getState().setSpace(null)
    searchRendered.mockClear()
  })

  it('gérant ouvert sur « / » (lancement) : son accueil, sans rendre la recherche', async () => {
    expect(await pathFor('approved', '/')).toBe('/manager/stocks')
    expect(screen.getByText('écran stocks')).toBeTruthy()
    expect(searchRendered).not.toHaveBeenCalled()
  })

  it('dossier en attente ouvert sur « / » : le statut, sans rendre la recherche', async () => {
    expect(await pathFor('pending', '/')).toBe('/manager/status')
    expect(searchRendered).not.toHaveBeenCalled()
  })

  it('station approuvée : les stocks sont l’accueil', async () => {
    expect(await pathFor('approved', '/manager/stocks')).toBe('/manager/stocks')
    expect(screen.getByText('écran stocks')).toBeTruthy()
  })

  it('station approuvée : un lien vers le statut mène à l’accueil', async () => {
    // Ancre du groupe d'onglets (/manager) : le premier onglet, les stocks.
    expect(await pathFor('approved', '/manager/status')).not.toBe('/manager/status')
    expect(screen.getByText('écran stocks')).toBeTruthy()
    expect(screen.queryByText('écran statut')).toBeNull()
  })

  it('dossier en attente : un lien vers les stocks mène au statut', async () => {
    expect(await pathFor('pending', '/manager/stocks')).toBe('/manager/status')
    expect(screen.getByText('écran statut')).toBeTruthy()
  })

  it('dossier en attente : pas de correction (réservée au refus)', async () => {
    expect(await pathFor('pending', '/manager/edit')).toBe('/manager/status')
  })

  it('dossier refusé : correction et nouveau justificatif ouverts', async () => {
    expect(await pathFor('rejected', '/manager/edit')).toBe('/manager/edit')
    expect(screen.getByText('écran correction')).toBeTruthy()
  })

  it('station suspendue : statut seulement', async () => {
    expect(await pathFor('suspended', '/manager/products')).toBe('/manager/status')
  })
})
