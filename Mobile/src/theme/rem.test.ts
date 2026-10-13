import metroConfig from '../../metro.config.js'

// Régression : NativeWind compte 1 rem = 14 dp par défaut. Toutes les tailles en rem étaient réduites
// de 12,5 % (boutons icône `h-12` de 42 dp au lieu de 48, sous la cible tactile minimale).
// jest.mock est hissé au-dessus de l'import par babel-jest.
jest.mock('expo/metro-config', () => ({ getDefaultConfig: () => ({ resolver: {} }) }))
jest.mock('nativewind/metro', () => ({
  withNativeWind: (config: object, options: object) => ({ ...config, nativewind: options }),
}))

describe('NativeWind', () => {
  it('1 rem = 16 dp : h-12 fait 48 dp, comme le prévoit le design system', () => {
    expect((metroConfig as unknown as { nativewind: { inlineRem: number } }).nativewind.inlineRem).toBe(16)
  })
})
