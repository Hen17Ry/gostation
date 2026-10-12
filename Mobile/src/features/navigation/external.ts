import * as Linking from 'expo-linking'
import { Platform } from 'react-native'

import type { LatLng } from '@/lib/geo'

/**
 * Ouvre une autre app de navigation vers la station (repli quand /routes répond 503). Android :
 * intent `geo:` (choix de l'app par le système) ; iOS : Apple Plans. Seule la position de la
 * station part dans le lien, jamais celle de l'utilisateur.
 */
export function externalNavigationUrl(station: LatLng, name: string, os: string = Platform.OS): string {
  const label = encodeURIComponent(name)
  const at = `${station.lat},${station.lng}`
  return os === 'ios' ? `https://maps.apple.com/?daddr=${at}&q=${label}` : `geo:${at}?q=${at}(${label})`
}

export const openExternalNavigation = (station: LatLng, name: string) =>
  Linking.openURL(externalNavigationUrl(station, name))
