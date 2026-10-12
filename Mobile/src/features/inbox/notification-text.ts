import type { Notification } from '@/api/schemas'
import { t } from '@/i18n'

const str = (d: Record<string, unknown>, k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '')

/**
 * Texte d'une notification composé d'après `type` + `data` (jamais d'après un texte serveur).
 * `station_reported` ne nomme jamais les auteurs : seule la station figure dans les données.
 */
export function notificationText(n: Pick<Notification, 'type' | 'data'>): string {
  const station = str(n.data, 'stationName')
  switch (n.type) {
    case 'back_in_stock':
      return t.inbox.types.back_in_stock(str(n.data, 'productLabel'), station)
    case 'station_reported':
      return t.inbox.types.station_reported(station)
    case 'stock_reminder':
      return t.inbox.types.stock_reminder(station)
    default:
      return t.inbox.unknown
  }
}

export const notificationStationId = (n: Pick<Notification, 'data'>) => {
  const id = n.data.stationId
  return typeof id === 'string' ? id : null
}
