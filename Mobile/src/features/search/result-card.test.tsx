import { fireEvent, screen } from '@testing-library/react-native'

import type { SearchResult } from '@/api/schemas'
import { renderWithProviders } from '@/test/render'

import { ResultCard } from './result-card'

const base: SearchResult = {
  station: { id: 'st-1', name: 'Station Akpakpa', brand: 'Oryx', location: { lat: 6.37, lng: 2.44 } },
  distanceM: 1200,
  routeDistanceM: 1650,
  durationS: 360,
  quantity: 14,
  stale: false,
  stockUpdatedAt: '2026-10-12T18:00:00Z',
  updatedAgoS: 12 * 60,
  isOpen: true,
  nextOpening: null,
  servedAt: null,
  reported: false,
}

async function renderCard(r: Partial<SearchResult>, approximate = false) {
  const onOpen = jest.fn()
  const onRoute = jest.fn()
  await renderWithProviders(
    <ResultCard
      result={{ ...base, ...r }}
      rank={1}
      unit="cylinder"
      approximate={approximate}
      selected={false}
      onOpen={onOpen}
      onRoute={onRoute}
    />,
  )
  return { onOpen, onRoute }
}

describe('ResultCard', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-10-12T19:00:00Z') })
  })
  afterAll(() => jest.useRealTimers())

  it('affiche nom, marque, trajet, quantité et fraîcheur', async () => {
    await renderCard({})
    expect(screen.getByText('Station Akpakpa')).toBeOnTheScreen()
    expect(screen.getByText(/Oryx · 1,7 km · 6 min/)).toBeOnTheScreen()
    expect(screen.getByText('14 bouteilles')).toBeOnTheScreen()
    expect(screen.getByText('Mis à jour il y a 12 min')).toBeOnTheScreen()
    expect(screen.queryByText('À vérifier')).toBeNull()
  })

  it('montre les badges « À vérifier » et « Signalée »', async () => {
    await renderCard({ stale: true, reported: true })
    expect(screen.getByText('À vérifier')).toBeOnTheScreen()
    expect(screen.getByText('Signalée')).toBeOnTheScreen()
  })

  it('station fermée : « Fermée · rouvre demain à 06:00 » (heure du Bénin)', async () => {
    await renderCard({ isOpen: false, nextOpening: '2026-10-13T05:00:00Z' })
    expect(screen.getByText('Fermée · rouvre demain à 06:00')).toBeOnTheScreen()
  })

  // Régression : la ligne partageait sa rangée avec « Itinéraire » sur une seule ligne et l'heure
  // était tronquée (« rouvre demain à 00:… »).
  it('ne tronque jamais l’heure de réouverture', async () => {
    await renderCard({ isOpen: false, nextOpening: '2026-10-13T05:00:00Z' })
    expect(screen.getByTestId('result-1-closed').props.numberOfLines).toBeUndefined()
  })

  it('distances estimées : préfixe ≈', async () => {
    await renderCard({ routeDistanceM: null }, true)
    expect(screen.getByText(/≈ 1,2 km · ≈ 6 min/)).toBeOnTheScreen()
  })

  it('ouvre la fiche ou l’itinéraire', async () => {
    const { onOpen, onRoute } = await renderCard({})
    await fireEvent.press(screen.getByTestId('result-1-route'))
    expect(onRoute).toHaveBeenCalledWith('st-1')
    await fireEvent.press(screen.getByTestId('result-1'))
    expect(onOpen).toHaveBeenCalledWith('st-1')
  })

  it('résume tout pour les lecteurs d’écran', async () => {
    await renderCard({ stale: true })
    const label = screen.getByTestId('result-1').props.accessibilityLabel as string
    expect(label).toContain('1. Station Akpakpa')
    expect(label).toContain('14 bouteilles')
    expect(label).toContain('Stock mis à jour il y a plus de 8 h')
  })
})
