import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { useEffect } from 'react'
import { Platform } from 'react-native'

import { registerPushDevice } from '@/api/account'
import { useMe } from '@/features/auth/use-me'
import { installId } from '@/lib/install-id'

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
 * À chaque lancement, compte connecté à l'email vérifié et autorisation accordée : enregistre
 * l'appareil, puis à chaque changement de token. Le logout et la révocation de la session
 * suppriment le token côté serveur (règle 12) : rien à faire ici.
 */
export function usePushRegistration(deps: PushRegistrationDeps = defaults) {
  const { me } = useMe()
  const granted = usePushPermission((s) => s.status === 'granted')
  const userId = me?.emailVerified ? me.id : null
  useEffect(() => {
    if (!userId || !granted) return
    void registerThisDevice(deps)
    const sub = Notifications.addPushTokenListener(() => void registerThisDevice(deps))
    return () => sub.remove()
  }, [userId, granted, deps])
}
