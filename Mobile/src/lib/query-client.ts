import NetInfo from '@react-native-community/netinfo'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query'
import { AppState, type AppStateStatus } from 'react-native'

import { PERSISTED_PREFIX } from '@/api/keys'
import { isApiError } from '@/api/errors'

import { storage } from './storage'

/**
 * Client TanStack Query : nouvel essai seulement sur erreur réseau ou 5xx (deux au plus), pas de
 * rechargement au retour de focus pour économiser la data (les écrans qui en ont besoin le
 * demandent), état réseau suivi par NetInfo.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, error) => count < 2 && (!isApiError(error) || error.isRetryable),
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        staleTime: 15_000,
        // Hors ligne : on garde l'affichage des données en cache plutôt que de suspendre.
        networkMode: 'offlineFirst',
      },
      mutations: { retry: false, networkMode: 'online' },
    },
  })
}

/** Cache persisté (MMKV) : uniquement les requêtes publiques réussies (catalogue, fiches). */
export const persister = createSyncStoragePersister({
  key: 'query-cache',
  storage: {
    getItem: (k) => storage.getString(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => void storage.remove(k),
  },
  throttleTime: 2000,
})

export const persistOptions = {
  persister,
  maxAge: 7 * 24 * 3600_000,
  // À changer quand la forme des données persistées change (purge du cache local).
  buster: 'v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (q: { queryKey: readonly unknown[]; state: { status: string } }) =>
      q.queryKey[0] === PERSISTED_PREFIX && q.state.status === 'success',
  },
}

/** Branche NetInfo (en ligne / hors ligne) et AppState (premier plan) sur TanStack Query. */
export function bindQueryManagers() {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false)),
  )
  const sub = AppState.addEventListener('change', (status: AppStateStatus) =>
    focusManager.setFocused(status === 'active'),
  )
  return () => sub.remove()
}
