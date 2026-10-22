import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { useEffect } from 'react'
import { Platform } from 'react-native'

import { registerPushDevice } from '@/api/account'
import { useMe } from '@/features/auth/use-me'
import { installId } from '@/lib/install-id'

import { pushSupported } from './availability'
import { usePushPermission } from './permission'

/** Projet EAS : identifie l'app auprès du service push d'Expo (token ExponentPushToken[…]). */
const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId

export interface PushRegistrationDeps {
  getToken: () => Promise<string>
  register: typeof registerPushDevice
}

const defaults: PushRegistrationDeps = {
  getToken: async () => (await Notifications.getExpoPushTokenAsync({ projectId })).data,
  register: registerPushDevice,
}

/**
 * Enregistre l'appareil de cette installation (`POST /me/devices` : token Expo, plateforme, même
 * UUID que X-Install-Id, langue). Renvoie le token, ou null si l'enregistrement a échoué (réseau :
 * le prochain lancement réessaie).
 */
export async function registerThisDevice(deps: PushRegistrationDeps = defaults): Promise<string | null> {
  try {
    const token = await deps.getToken()
    await deps.register({
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      installId: installId(),
      language: 'fr',
      appVersion: Constants.expoConfig?.version ?? null,
    })
    return token
  } catch {
    return null
  }
}

/**
 * Filtre des événements de token. Sur Android, chaque lecture du token (getExpoPushTokenAsync
 * compris) réémet l'événement avec la même valeur (PushTokenModule.getDevicePushTokenAsync
 * d'expo-notifications) : sans ce filtre, chaque enregistrement déclenchait le suivant, une boucle
 * de POST /me/devices (jusqu'à 15 par seconde, vue sur le staging). Vrai seulement pour un token
 * d'appareil différent du dernier vu ; le premier vu (écho de la lecture du lancement) est retenu.
 */
export function tokenChangeFilter(): (deviceToken: string) => boolean {
  let last: string | null = null
  return (deviceToken) => {
    const changed = last !== null && deviceToken !== last
    last = deviceToken
    return changed
  }
}

/**
 * À chaque lancement, compte connecté à l'email vérifié et autorisation accordée : enregistre
 * l'appareil, puis à chaque changement de token. Le logout et la révocation de la session
 * suppriment le token côté serveur (règle 12) : rien à faire ici. Téléphone sans services Google :
 * aucun token possible, rien n'est tenté.
 */
export function usePushRegistration(deps: PushRegistrationDeps = defaults, supported: boolean = pushSupported()) {
  const { me } = useMe()
  const granted = usePushPermission((s) => s.status === 'granted')
  const userId = me?.emailVerified ? me.id : null
  useEffect(() => {
    if (!userId || !granted || !supported) return
    const changed = tokenChangeFilter()
    void registerThisDevice(deps)
    const sub = Notifications.addPushTokenListener(({ data }) => {
      if (changed(String(data))) void registerThisDevice(deps)
    })
    return () => sub.remove()
  }, [userId, granted, deps, supported])
}
