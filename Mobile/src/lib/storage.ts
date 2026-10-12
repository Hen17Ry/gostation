import { createMMKV } from 'react-native-mmkv'

/**
 * Stockage local non sensible (MMKV) : préférences, cache des données publiques (catalogue, fiches
 * de stations), identifiant d'installation. Jamais de jeton (expo-secure-store) ni de position de
 * l'utilisateur, même passée (règle 2).
 */
export const storage = createMMKV({ id: 'gostation' })

export function readJSON<T>(key: string): T | undefined {
  const raw = storage.getString(key)
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    storage.remove(key)
    return undefined
  }
}

export function writeJSON(key: string, value: unknown) {
  storage.set(key, JSON.stringify(value))
}
