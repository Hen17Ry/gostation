import { screen } from '@testing-library/react-native'
import { Text } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'

import { renderWithProviders } from '@/test/render'

import { StagingFrame } from './staging-frame'

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, right: 0, bottom: 16, left: 0 } }

function Inset() {
  const insets = useSafeAreaInsets()
  return <Text>{`top ${insets.top} bottom ${insets.bottom}`}</Text>
}

function renderFrame() {
  return renderWithProviders(
    <SafeAreaProvider initialMetrics={metrics}>
      <StagingFrame>
        <Inset />
      </StagingFrame>
    </SafeAreaProvider>,
  )
}

describe('StagingFrame', () => {
  const env = process.env.EXPO_PUBLIC_APP_ENV
  afterEach(() => {
    process.env.EXPO_PUBLIC_APP_ENV = env
  })

  it('staging : bandeau annoncé, marge haute des écrans prise par le bandeau', async () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'staging'
    await renderFrame()
    expect(screen.getByLabelText('Staging : test, données fictives')).toBeOnTheScreen()
    expect(screen.getByText('top 0 bottom 16')).toBeOnTheScreen()
  })

  it('production : aucun bandeau, marges inchangées', async () => {
    delete process.env.EXPO_PUBLIC_APP_ENV
    await renderFrame()
    expect(screen.queryByTestId('staging-banner')).toBeNull()
    expect(screen.getByText('top 24 bottom 16')).toBeOnTheScreen()
  })
})
