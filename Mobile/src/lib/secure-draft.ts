import { randomUUID } from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { createMMKV, type MMKV } from 'react-native-mmkv'

/**
 * Brouillons qui contiennent des données personnelles (inscription du gérant, D62) : MMKV chiffré
 * en AES-256, clé tirée au hasard et gardée dans le Keystore (expo-secure-store). Jamais de mot de
 * passe ni de fichier : seulement des champs texte, effacés après l'envoi.
 */
const KEY_NAME = 'gostation.draft-key'
let pending: Promise<MMKV> | null = null

function open(): Promise<MMKV> {
  pending ??= (async () => {
    let key = await SecureStore.getItemAsync(KEY_NAME)
    if (!key) {
      key = (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 32)
      await SecureStore.setItemAsync(KEY_NAME, key)
    }
    return createMMKV({ id: 'gostation-drafts', encryptionKey: key, encryptionType: 'AES-256' })
  })()
  return pending
}

export async function readSecureDraft<T>(name: string): Promise<T | undefined> {
  const raw = (await open()).getString(name)
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

export async function writeSecureDraft(name: string, value: unknown) {
  ;(await open()).set(name, JSON.stringify(value))
}

export async function clearSecureDraft(name: string) {
  ;(await open()).remove(name)
}
