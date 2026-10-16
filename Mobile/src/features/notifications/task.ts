import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { AppState } from 'react-native'

import { ACTION_CONFIRM } from './channels'
import { claimResponse, confirmFromNotification, responseKey } from './confirm'
import { isPushType, presentPush, remoteData } from './present'

/**
 * Tâche de fond des notifications (Android), définie dans la portée du module et importée en
 * premier par le point d'entrée (index.ts), comme l'exige expo-task-manager. expo-notifications la
 * lance, le JS étant chargé sans interface si l'app est tuée :
 * - à la réception d'un push (message de données sur Android, D75) : présenté avec son texte, son
 *   canal et, pour un rappel, ses actions ; app au premier plan, le toast suffit (runtime.tsx) ;
 * - au toucher d'une action à `opensAppToForeground: false` (« Rien n'a changé »), app en
 *   arrière-plan ou tuée.
 */
export const PUSH_ACTIONS_TASK = 'gostation-push-actions'

TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_ACTIONS_TASK, async ({ data }) => {
  if (!data) return Notifications.BackgroundNotificationTaskResult.NoData
  if (!('actionIdentifier' in data)) {
    const payload = remoteData(data)
    if (!payload || !isPushType(payload.type) || AppState.currentState === 'active') {
      return Notifications.BackgroundNotificationTaskResult.NoData
    }
    await presentPush(payload)
    return Notifications.BackgroundNotificationTaskResult.NewData
  }
  if (data.actionIdentifier !== ACTION_CONFIRM || !claimResponse(responseKey(data))) {
    return Notifications.BackgroundNotificationTaskResult.NoData
  }
  const outcome = await confirmFromNotification(data.notification.request.identifier)
  return outcome === 'confirmed'
    ? Notifications.BackgroundNotificationTaskResult.NewData
    : Notifications.BackgroundNotificationTaskResult.Failed
})

void Notifications.registerTaskAsync(PUSH_ACTIONS_TASK).catch(() => undefined)
