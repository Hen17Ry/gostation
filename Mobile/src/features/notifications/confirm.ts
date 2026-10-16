import * as Notifications from 'expo-notifications'

import { session } from '@/api/client'
import { isApiError } from '@/api/errors'
import { confirmStocks, loadStocks } from '@/api/manager'
import { t } from '@/i18n'
import { storage } from '@/lib/storage'

import { CHANNELS } from './channels'

export type ConfirmOutcome = 'confirmed' | 'signed-out' | 'failed'

export interface ConfirmDeps {
  hasSession: () => Promise<boolean>
  load: () => Promise<{ etag: string }>
  confirm: (etag: string) => Promise<unknown>
}

const defaults: ConfirmDeps = {
  hasSession: () => session.load(),
  load: () => loadStocks(),
  confirm: confirmStocks,
}

/**
 * « Rien n'a changé » touché dans un rappel : lit la version courante des stocks puis confirme
 * (`POST …/stocks/confirm` avec `If-Match`), le jeton étant renouvelé au besoin (refresh
 * single-flight du client). La version du push n'est pas réutilisée : toute écriture sur la station
 * (horaires, produits…) la change, et la confirmation porterait sur des stocks inchangés. Un 412
 * entre la lecture et l'envoi : une seconde tentative avec la version relue.
 */
export async function confirmUnchangedStocks(deps: ConfirmDeps = defaults): Promise<ConfirmOutcome> {
  if (!(await deps.hasSession())) return 'signed-out'
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { etag } = await deps.load()
      await deps.confirm(etag)
      return 'confirmed'
    } catch (e) {
      if (isApiError(e) && e.status === 412 && attempt === 0) continue
      if (isApiError(e) && (e.status === 401 || e.status === 403)) return 'signed-out'
      return 'failed'
    }
  }
  return 'failed'
}

/**
 * Une réponse à une notification n'est traitée qu'une fois : la tâche de fond (app en arrière-plan
 * ou tuée) et l'app relancée plus tard (dernière réponse) la verraient sinon toutes les deux.
 */
const HANDLED_KEY = 'push.handled'

export function claimResponse(key: string): boolean {
  const handled: string[] = JSON.parse(storage.getString(HANDLED_KEY) ?? '[]')
  if (handled.includes(key)) return false
  storage.set(HANDLED_KEY, JSON.stringify([...handled.slice(-19), key]))
  return true
}

export const responseKey = (r: { actionIdentifier: string; notification: { request: { identifier: string } } }) =>
  `${r.notification.request.identifier}:${r.actionIdentifier}`

/**
 * Traite l'action en arrière-plan : confirme, retire le rappel du volet et le remplace par une
 * notification discrète (canal sans son), ou, en cas d'échec, par une invitation à ouvrir l'app.
 */
export async function confirmFromNotification(reminderIdentifier: string): Promise<ConfirmOutcome> {
  const outcome = await confirmUnchangedStocks()
  await Notifications.dismissNotificationAsync(reminderIdentifier).catch(() => undefined)
  const ok = outcome === 'confirmed'
  await Notifications.scheduleNotificationAsync({
    content: {
      title: ok ? t.push.confirmed : t.push.confirmFailed,
      body: ok ? t.push.confirmedBody : t.push.confirmFailedBody,
      // Touchée, la notification d'échec ouvre l'écran Stocks (même routage qu'un rappel).
      data: ok ? { local: 'confirmation' } : { local: 'confirmation', type: 'stock_reminder' },
    },
    trigger: { channelId: ok ? CHANNELS.confirmations : CHANNELS.reminders },
  }).catch(() => undefined)
  return outcome
}
