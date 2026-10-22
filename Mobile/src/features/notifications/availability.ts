import { Platform } from 'react-native'

import { hasPlayServices } from '@/lib/play-services'

import { type PushPermission, usePushPermission } from './permission'

/**
 * Push possible sur ce téléphone : iOS, ou Android avec Google Play Services (FCM). Sans eux
 * (Huawei récents), aucun token : pas d'enregistrement de l'appareil, pas de demande
 * d'autorisation ; la boîte de réception est relue à l'ouverture et au retour au premier plan, et
 * le gérant voit un rappel dans l'app (écran Stocks).
 */
export function pushSupported(os: string = Platform.OS, playServices: () => boolean = hasPlayServices): boolean {
  return os !== 'android' || playServices()
}

/**
 * Boîte de réception relue au retour au premier plan quand aucun push ne peut l'annoncer
 * (téléphone sans services Google, ou notifications non autorisées). Avec le push, il suffit
 * (data comptée, D50).
 */
export function inboxRefetchOnFocus(supported: boolean, permission: PushPermission): boolean {
  return !supported || permission !== 'granted'
}

/** `refetchOnWindowFocus` de la requête de la boîte de réception (onglets utilisateur et gérant). */
export function useInboxRefetchOnFocus(): boolean {
  const permission = usePushPermission((s) => s.status)
  return inboxRefetchOnFocus(pushSupported(), permission)
}
