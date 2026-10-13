import { onlineManager } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native'
import { Keyboard } from 'react-native'

import { t } from '@/i18n'
import { renderWithProviders } from '@/test/render'

import { useStockDraft } from './stock-draft'
import { StocksScreen } from './stocks-screen'

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }))
jest.mock('@gorhom/bottom-sheet', () => jest.requireActual('@gorhom/bottom-sheet/mock'))
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
)

const now = new Date().toISOString()
const stockItem = (productId: number, code: string, label: string, unit: 'cylinder' | 'liter', quantity: number) => ({
  productId,
  code,
  label,
  unit,
  sizeKg: unit === 'cylinder' ? 12.5 : null,
  quantity,
  maxQuantity: unit === 'cylinder' ? 10_000 : 200_000,
  updatedAt: now,
  lastConfirmedAt: now,
  freshAt: now,
  freshness: 'fresh',
})
const stocks = (lpg: number, petrol = 12_500) => ({
  lastActivityAt: now,
  items: [
    stockItem(1, 'lpg_12_5kg', 'Gaz 12,5 kg', 'cylinder', lpg),
    stockItem(2, 'petrol', 'Essence', 'liter', petrol),
  ],
})
const station = {
  id: '01a1360d-2580-7faf-a50d-7961dcbee9df',
  status: 'approved',
  statusReason: null,
  version: 3,
  name: 'Station Zongo Marché',
  brand: 'Oryx',
  ifu: '3245503162192',
  rccm: 'RB/COT/26 B 1234',
  address: 'Boulevard de la Marina',
  city: 'Cotonou',
  phone: '+22997000000',
  location: { lat: 6.36, lng: 2.41 },
  locationSetAt: now,
  locationFlag: null,
  pendingMove: null,
  setup: { location: true, openingHours: true, products: true, stocks: true, searchable: true, missing: [] },
  lastStockUpdateAt: now,
  createdAt: now,
  updatedAt: now,
}

type Call = { method: string; path: string; ifMatch: string | null; body: unknown }
let calls: Call[]
let serverStocks: ReturnType<typeof stocks>
let version: number
/** Réponse de PUT : 412 forcé une fois pour simuler une saisie concurrente. */
let conflictOnce: (() => void) | null

const json = (status: number, body: unknown, etag?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json',
      ...(etag ? { ETag: etag } : {}),
    },
  })

beforeEach(() => {
  useStockDraft.getState().clear()
  onlineManager.setOnline(true)
  calls = []
  serverStocks = stocks(10)
  version = 3
  conflictOnce = null
  globalThis.fetch = jest.fn(async (req: Request) => {
    const path = new URL(req.url).pathname
    const body = req.method === 'GET' ? undefined : await req.text().then((b) => (b ? JSON.parse(b) : undefined))
    calls.push({ method: req.method, path, ifMatch: req.headers.get('If-Match'), body })
    const etag = `"v${version}"`
    if (path === '/api/v1/manager/station') return json(200, { ...station, version }, etag)
    if (path === '/api/v1/manager/station/stocks' && req.method === 'GET') return json(200, serverStocks, etag)
    if (path === '/api/v1/manager/station/stocks' && req.method === 'PUT') {
      if (conflictOnce) {
        conflictOnce()
        conflictOnce = null
        return json(412, { status: 412, code: 'resource.version_conflict' })
      }
      if (req.headers.get('If-Match') !== etag) return json(412, { status: 412, code: 'resource.version_conflict' })
      const items = (body as { items: { productId: number; quantity: number }[] }).items
      serverStocks = {
        ...serverStocks,
        items: serverStocks.items.map((i) => ({
          ...i,
          quantity: items.find((x) => x.productId === i.productId)!.quantity,
        })),
      }
      version += 1
      return json(200, serverStocks, `"v${version}"`)
    }
    if (path === '/api/v1/manager/station/stocks/confirm') {
      version += 1
      return json(200, serverStocks, `"v${version}"`)
    }
    return json(404, { status: 404, code: 'route.not_found' })
  }) as typeof fetch
})

async function renderStocks() {
  await renderWithProviders(<StocksScreen />)
  await screen.findByText('Gaz 12,5 kg')
}

const submit = () => screen.getByTestId('stocks-submit')

describe('saisie des stocks (D59)', () => {
  it('compteur, récapitulatif puis envoi groupé avec If-Match', async () => {
    await renderStocks()
    expect(screen.getByText(t.manager.stocks.nothingChanged)).toBeTruthy()
    await fireEvent.press(screen.getByTestId('stock-lpg_12_5kg-qty-plus'))
    await fireEvent.press(screen.getByTestId('stock-lpg_12_5kg-qty-plus'))
    expect(screen.getByText(t.manager.stocks.save(1))).toBeTruthy()
    // Récapitulatif : avant → après, puis envoi.
    expect(screen.getByLabelText('Gaz 12,5 kg : 10 bouteilles, 12 bouteilles')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('stocks-send'))
    await waitFor(() => expect(screen.getByText(t.manager.stocks.nothingChanged)).toBeTruthy())
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.ifMatch).toBe('"v3"')
    expect(put.body).toEqual({
      items: [
        { productId: 1, quantity: 12 },
        { productId: 2, quantity: 12_500 },
      ],
    })
  })

  it('sans changement, « Rien n’a changé » confirme les stocks', async () => {
    await renderStocks()
    await fireEvent.press(submit())
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/stocks/confirm'))).toBe(true))
    expect(calls.find((c) => c.path.endsWith('/stocks/confirm'))!.ifMatch).toBe('"v3"')
  })

  it('« Rupture » met le produit à 0 ; les litres se saisissent au pavé numérique', async () => {
    await renderStocks()
    await fireEvent.press(screen.getByTestId('stock-lpg_12_5kg-out'))
    await fireEvent.changeText(screen.getByTestId('stock-petrol-qty'), '8 000')
    expect(screen.getByText(t.manager.stocks.save(2))).toBeTruthy()
    expect(useStockDraft.getState().values).toEqual({ 1: 0, 2: 8000 })
  })

  it('l’enregistrement ferme le clavier et quitte le champ des litres', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss')
    await renderStocks()
    await fireEvent.changeText(screen.getByTestId('stock-petrol-qty'), '8 000')
    await fireEvent.press(submit())
    expect(dismiss).toHaveBeenCalled()
    dismiss.mockRestore()
  })

  it('hors connexion : saisie gardée, envoi bloqué puis proposé au retour du réseau', async () => {
    await renderStocks()
    await act(() => onlineManager.setOnline(false))
    await fireEvent.press(screen.getByTestId('stock-lpg_12_5kg-qty-minus'))
    expect(submit().props.accessibilityState).toMatchObject({ disabled: true })
    expect(screen.getByText(t.manager.stocks.draftKept)).toBeTruthy()
    // Brouillon dans le store persisté (MMKV), avec la version saisie.
    expect(useStockDraft.getState()).toMatchObject({ values: { 1: 9 }, base: { etag: '"v3"' } })
    await act(() => onlineManager.setOnline(true))
    expect(await screen.findByText(t.manager.stocks.backOnline)).toBeTruthy()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('412 : montre ce qui a changé entre-temps et recharge sans perdre la saisie', async () => {
    await renderStocks()
    await fireEvent.press(screen.getByTestId('stock-lpg_12_5kg-qty-plus'))
    // Un autre appareil a saisi 14 bouteilles pendant ce temps.
    conflictOnce = () => {
      serverStocks = stocks(14)
      version = 4
    }
    await fireEvent.press(screen.getByTestId('stocks-send'))
    expect(
      await screen.findByLabelText(
        `Gaz 12,5 kg : ${t.manager.stocks.conflictBefore} 10 bouteilles, ${t.manager.stocks.conflictNow} 14 bouteilles, ${t.manager.stocks.conflictYours} 11 bouteilles`,
      ),
    ).toBeTruthy()
    await fireEvent.press(screen.getByTestId('stocks-reload'))
    expect(useStockDraft.getState()).toMatchObject({ values: { 1: 11 }, base: { etag: '"v4"' } })
    // Nouvel envoi : la saisie part avec la nouvelle version.
    await fireEvent.press(screen.getByTestId('stocks-send'))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').at(-1)!.ifMatch).toBe('"v4"'))
  })

  it('412 sans changement des stocks (autre écran) : rejoué une fois avec la nouvelle version', async () => {
    await renderStocks()
    await fireEvent.press(screen.getByTestId('stock-lpg_12_5kg-qty-plus'))
    conflictOnce = () => {
      version = 5
    }
    await fireEvent.press(screen.getByTestId('stocks-send'))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2))
    expect(calls.filter((c) => c.method === 'PUT')[1]!.ifMatch).toBe('"v5"')
    expect(serverStocks.items[0]!.quantity).toBe(11)
  })
})
