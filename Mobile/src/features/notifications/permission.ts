import * as Notifications from 'expo-notifications'
import { useEffect } from 'react'
import { AppState, Linking } from 'react-native'
import { create } from 'zustand'

import { storage } from '@/lib/storage'

/**
 * Autorisation des notifications, jamais demandée au premier lancement : au gérant juste après la
 * validation de sa station (écran d'explication des rappels), à l'utilisateur à l'activation de sa
 * première alerte « de retour en stock ». Android 13+ demande POST_NOTIFICATIONS ; avant (Android
 * 12 et moins), l'autorisation est accordée d'office.
 */
export type PushPermission = 'unknown' | 'granted' | 'denied' | 'undetermined'

interface PermissionState {
  status: PushPermission
  /** false : le système ne montrera plus sa demande (refus définitif), seuls les réglages restent. */
  canAskAgain: boolean
}

export const usePushPermission = create<PermissionState>(() => ({ status: 'unknown', canAskAgain: true }))

/**
 * Android 13+ répond « denied » avant toute demande (avec `canAskAgain`) : l'autorisation n'est
 * refusée qu'après une demande faite par l'app, ou quand le système ne la montrera plus.
 */
const ASKED_KEY = 'push.permissionAsked'

export function permissionOf(p: Notifications.NotificationPermissionsStatus, asked: boolean): PushPermission {
  if (p.granted) return 'granted'
  return p.status === 'denied' && (asked || !p.canAskAgain) ? 'denied' : 'undetermined'
}

function apply(p: Notifications.NotificationPermissionsStatus): PushPermission {
  const status = permissionOf(p, storage.getBoolean(ASKED_KEY) ?? false)
  usePushPermission.setState({ status, canAskAgain: p.canAskAgain })
  return status
}

/** Relit l'autorisation (démarrage, retour des réglages du système). */
export async function refreshPushPermission(): Promise<PushPermission> {
  return apply(await Notifications.getPermissionsAsync())
}

/** Montre la demande du système si elle peut encore l'être ; sinon renvoie l'état courant. */
export async function requestPushPermission(): Promise<PushPermission> {
  const current = await Notifications.getPermissionsAsync()
  if (current.granted || !current.canAskAgain) return apply(current)
  storage.set(ASKED_KEY, true)
  return apply(await Notifications.requestPermissionsAsync())
}

/** Réglages de l'app dans le système (autorisation refusée). */
export const openNotificationSettings = () => Linking.openSettings()

/** À monter une fois (racine) : lit l'autorisation au démarrage et à chaque retour au premier plan. */
export function usePushPermissionRefresh() {
  useEffect(() => {
    void refreshPushPermission()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPushPermission()
    })
    return () => sub.remove()
  }, [])
}
