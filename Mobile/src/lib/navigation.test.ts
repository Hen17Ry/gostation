import { renderHook } from '@testing-library/react-native'
import { router, useNavigation } from 'expo-router'

import { useCloseFlow } from './navigation'

jest.mock('expo-router', () => ({ router: { replace: jest.fn() }, useNavigation: jest.fn() }))

describe('useCloseFlow', () => {
  beforeEach(() => jest.clearAllMocks())

  it('retire la pile du parcours via le navigateur parent (régression : retour sur un autre onglet)', async () => {
    const parent = { canGoBack: jest.fn(() => true), goBack: jest.fn() }
    jest.mocked(useNavigation).mockReturnValue({ getParent: () => parent } as never)
    const { result } = await renderHook(() => useCloseFlow())
    result.current()
    expect(parent.goBack).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('revient à l’accueil s’il n’y a rien derrière', async () => {
    jest.mocked(useNavigation).mockReturnValue({ getParent: () => undefined } as never)
    const { result } = await renderHook(() => useCloseFlow())
    result.current()
    expect(router.replace).toHaveBeenCalledWith('/')
  })
})
