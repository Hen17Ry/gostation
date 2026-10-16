import * as Notifications from 'expo-notifications'

import { notificationText } from '@/features/inbox/notification-text'
import { t } from '@/i18n'

import { CHANNELS, REMINDER_CATEGORY } from './channels'

const PUSH_TYPES = ['stock_reminder', 'station_reported', 'back_in_stock', 'station_decision'] as const
type PushType = (typeof PUSH_TYPES)[number]

const CHANNEL_OF: Record<PushType, string> = {
  stock_reminder: CHANNELS.reminders,
  station_reported: CHANNELS.reports,
  back_in_stock: CHANNELS.alerts,
  station_decision: CHANNELS.account,
}

const str = (d: Record<string, unknown>, k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '')
const num = (d: Record<string, unknown>, k: string) => (typeof d[k] === 'number' ? (d[k] as number) : null)

export const isPushType = (type: unknown): type is PushType => PUSH_TYPES.includes(type as PushType)

/**
 * Données d'un message reçu par la tâche de fond : Expo place les `data` du push, en JSON, dans
 * `data.dataString` (null si ce n'est pas un push d'Expo ou si le JSON est illisible).
 */
export function remoteData(payload: unknown): Record<string, unknown> | null {
  const raw = (payload as { data?: { dataString?: unknown } } | null)?.data?.dataString
  if (typeof raw !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Titre et texte d'un push, composés d'après le type et les données (jamais un texte serveur). */
export function pushText(type: PushType, data: Record<string, unknown>): { title: string; body: string } {
  const station = str(data, 'stationName')
  const product = str(data, 'productLabel')
  switch (type) {
    case 'stock_reminder':
      return { title: t.push.reminder.title, body: t.push.reminder.body(station, num(data, 'hoursSinceUpdate')) }
    case 'station_reported': {
      const r = t.push.reported
      const n = num(data, 'reporters') ?? 0
      if (data.level === 'excluded') return { title: r.excludedTitle, body: r.excluded(station, product, n) }
      const reason = str(data, 'reason')
      const body =
        reason === 'out_of_stock'
          ? r.out_of_stock(station, product, n)
          : reason === 'station_closed' || reason === 'wrong_location'
            ? r[reason](station, n)
            : r.other(station, n)
      return { title: r.title, body }
    }
    case 'back_in_stock':
      return { title: t.push.backInStock.title, body: t.push.backInStock.body(product, station) }
    case 'station_decision':
      return {
        title: t.push.decision[str(data, 'decision')] ?? t.push.fallbackTitle,
        body: notificationText({ type, data }),
      }
  }
}

/**
 * Push reçu en message de données (Android, D75), présenté par l'app : un push avec titre serait
 * affiché par le système, sans la catégorie du rappel ni ses actions, et son toucher perdrait le
 * lien vers l'écran du type si Android a tué le processus en gardant la tâche. Canal : celui du
 * serveur (`channelId`), sinon celui du type. L'identifiant de la notification du serveur sert
 * d'identifiant local : un message reçu deux fois remplace le premier.
 */
export async function presentPush(data: Record<string, unknown>) {
  if (!isPushType(data.type)) return
  const channels: readonly string[] = Object.values(CHANNELS)
  const channelId = channels.includes(str(data, 'channelId')) ? str(data, 'channelId') : CHANNEL_OF[data.type]
  await Notifications.scheduleNotificationAsync({
    identifier: str(data, 'notificationId') || undefined,
    content: {
      ...pushText(data.type, data),
      data,
      ...(data.type === 'stock_reminder' && { categoryIdentifier: REMINDER_CATEGORY }),
    },
    trigger: { channelId },
  })
}
