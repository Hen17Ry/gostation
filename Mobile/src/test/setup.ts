/* Mocks des modules natifs pour Jest (jest-expo). Aucun accès réseau ni capteur réel. */
import 'react-native-gesture-handler/jestSetup'

// Reanimated 4 : le runtime des worklets n'existe pas sous Jest, on le remplace par son mock.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'))
require('react-native-reanimated').setUpTests()

// MMKV (Nitro) : stockage en mémoire, même API que createMMKV.
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    const m = new Map<string, string | number | boolean>()
    return {
      set: (k: string, v: string | number | boolean) => void m.set(k, v),
      getString: (k: string) => (typeof m.get(k) === 'string' ? (m.get(k) as string) : undefined),
      getNumber: (k: string) => (typeof m.get(k) === 'number' ? (m.get(k) as number) : undefined),
      getBoolean: (k: string) => (typeof m.get(k) === 'boolean' ? (m.get(k) as boolean) : undefined),
      contains: (k: string) => m.has(k),
      remove: (k: string) => m.delete(k),
      getAllKeys: () => [...m.keys()],
      clearAll: () => m.clear(),
    }
  },
}))

jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'))

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    __store: store,
  }
})

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => undefined),
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}))

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => undefined) }))

jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }))

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4, BestForNavigation: 6 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'undetermined', canAskAgain: true })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  getLastKnownPositionAsync: jest.fn(async () => null),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 6.3654, longitude: 2.4183, accuracy: 10 } })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
}))
