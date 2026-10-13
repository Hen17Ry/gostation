import { act, render } from '@testing-library/react-native'
import { createRef, type ReactNode } from 'react'

import { RouteMap, type RouteMapHandle } from './route-map'

const mockFitBounds = jest.fn()
const mockMap: { finishLoading?: () => void } = {}

jest.mock('@maplibre/maplibre-react-native', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual<typeof import('react')>('react')
  const Pass = ({ children }: { children?: ReactNode }) => children ?? null
  return {
    Map: ({ children, onDidFinishLoadingMap }: { children?: ReactNode; onDidFinishLoadingMap?: () => void }) => {
      mockMap.finishLoading = onDidFinishLoadingMap
      return children
    },
    Camera: forwardRef(function Camera(_props: object, ref) {
      useImperativeHandle(ref, () => ({ fitBounds: mockFitBounds }))
      return null
    }),
    GeoJSONSource: Pass,
    Layer: () => null,
    NativeUserLocation: () => null,
    UserLocation: () => null,
  }
})

const station = { lat: 6.3654, lng: 2.4183 }
const origin = { lat: 6.37, lng: 2.41 }

describe('RouteMap', () => {
  // Régression : sans OSRM, le 503 arrivait avant le chargement de la carte ; le cadrage sur la
  // ligne droite était perdu et la carte restait au zoom par défaut.
  it('applique au chargement de la carte un cadrage demandé avant', async () => {
    const ref = createRef<RouteMapHandle>()
    await render(
      <RouteMap
        ref={ref}
        line={[origin, station]}
        dashed
        station={station}
        origin={origin}
        showUser={false}
        follow={false}
        topInset={0}
      />,
    )
    await act(() => ref.current?.fit([origin, station], { top: 64, bottom: 220 }))
    expect(mockFitBounds).not.toHaveBeenCalled()
    await act(() => mockMap.finishLoading?.())
    expect(mockFitBounds).toHaveBeenCalledTimes(1)
    await act(() => ref.current?.fit([origin, station], { top: 64, bottom: 240 }))
    expect(mockFitBounds).toHaveBeenCalledTimes(2)
  })
})
