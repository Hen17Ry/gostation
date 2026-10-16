import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { t } from '@/i18n'
import { tokens } from '@/theme/tokens.generated'

/**
 * Canaux Android, créés à chaque démarrage (opération idempotente qui ne demande aucune
 * autorisation). Le backend envoie le `channelId` de chaque type (internal/notification/render.go) ;
 * l'utilisateur règle le son et l'importance de chacun dans les paramètres du système.
 */
export const CHANNELS = {
  reminders: 'stock-reminders',
  alerts: 'stock-alerts',
  reports: 'reports',
  account: 'account',
  // Résultat de « Rien n'a changé » touché dans un rappel : discret, sans son ni bandeau.
  confirmations: 'stock-confirmations',
} as const

/** Catégorie des rappels de stock (D28) et ses deux actions. */
export const REMINDER_CATEGORY = 'stock_reminder'
export const ACTION_UPDATE = 'update'
export const ACTION_CONFIRM = 'confirm'

const accent = tokens.brand[600]

export async function setupNotificationChannels() {
  if (Platform.OS === 'android') {
    const { HIGH, DEFAULT, LOW } = Notifications.AndroidImportance
    const c = t.push.channels
    const channels: [string, string, string, Notifications.AndroidImportance][] = [
      [CHANNELS.reminders, c.reminders, c.remindersDescription, HIGH],
      [CHANNELS.alerts, c.alerts, c.alertsDescription, DEFAULT],
      [CHANNELS.reports, c.reports, c.reportsDescription, DEFAULT],
      [CHANNELS.account, c.account, c.accountDescription, DEFAULT],
      [CHANNELS.confirmations, c.confirmations, c.confirmationsDescription, LOW],
    ]
    await Promise.all(
      channels.map(([id, name, description, importance]) =>
        Notifications.setNotificationChannelAsync(id, {
          name,
          description,
          importance,
          lightColor: accent,
          // Sans `sound` : son par défaut du système (« default » serait lu comme un fichier absent,
          // canal muet) ; null : aucun son. Le son d'un canal ne change plus après sa création.
          ...(importance === LOW && { sound: null }),
          enableVibrate: importance !== LOW,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
          showBadge: importance !== LOW,
        }),
      ),
    )
  }
  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
    { identifier: ACTION_UPDATE, buttonTitle: t.push.actions.update, options: { opensAppToForeground: true } },
    // Confirme sans ouvrir l'app (tâche de fond, src/features/notifications/task.ts).
    { identifier: ACTION_CONFIRM, buttonTitle: t.push.actions.confirm, options: { opensAppToForeground: false } },
  ])
}
