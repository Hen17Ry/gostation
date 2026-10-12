import { randomUUID } from 'expo-crypto'

import { storage } from './storage'

const KEY = 'install-id'

/**
 * Identifiant d'installation (UUID tiré au premier lancement) : en-tête X-Install-Id des recherches
 * et itinéraires (quota par installation), et `installId` de l'appareil push (9B). Ce n'est pas un
 * secret ; il disparaît avec l'app.
 */
export function installId(): string {
  let id = storage.getString(KEY)
  if (!id) {
    id = randomUUID()
    storage.set(KEY, id)
  }
  return id
}
