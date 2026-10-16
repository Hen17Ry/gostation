import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { AppState } from 'react-native'

import { ACTION_CONFIRM, ACTION_UPDATE } from './channels'
import { confirmFromNotification } from './confirm'
import { presentPush } from './present'
import { PUSH_ACTIONS_TASK } from './task'

jest.mock('./present', () => ({
  ...jest.requireActual('./present'),
  presentPush: jest.fn(async () => undefined),
}))
jest.mock('./confirm', () => ({
  ...jest.requireActual('./confirm'),
  confirmFromNotification: jest.fn(async () => 'confirmed'),
}))

type Executor = (body: { data: unknown; error: null; executionInfo: object }) => Promise<unknown>
const executor = jest.mocked(TaskManager.defineTask).mock.calls.find(([name]) => name === PUSH_ACTIONS_TASK)?.[1] as
  Executor | undefined
const run = (data: unknown) => executor!({ data, error: null, executionInfo: {} })
const response = (actionIdentifier: string, identifier: string) => ({
  actionIdentifier,
  notification: { request: { identifier, content: { data: { type: 'stock_reminder' } } } },
})

describe('tâche des actions (app en arrière-plan ou tuée)', () => {
  it('définie au chargement du module et enregistrée auprès d’expo-notifications', () => {
    expect(executor).toBeDefined()
    expect(Notifications.registerTaskAsync).toHaveBeenCalledWith(PUSH_ACTIONS_TASK)
  })

  it('« Rien n’a changé » : confirme une seule fois par notification', async () => {
    expect(await run(response(ACTION_CONFIRM, 'rappel-t1'))).toBe(
      Notifications.BackgroundNotificationTaskResult.NewData,
    )
    expect(confirmFromNotification).toHaveBeenCalledWith('rappel-t1')
    expect(await run(response(ACTION_CONFIRM, 'rappel-t1'))).toBe(Notifications.BackgroundNotificationTaskResult.NoData)
    expect(confirmFromNotification).toHaveBeenCalledTimes(1)
  })

  it('autre action ou push de données : ignoré', async () => {
    expect(await run(response(ACTION_UPDATE, 'rappel-t2'))).toBe(Notifications.BackgroundNotificationTaskResult.NoData)
    expect(await run({ data: { type: 'stock_reminder' } })).toBe(Notifications.BackgroundNotificationTaskResult.NoData)
    expect(confirmFromNotification).not.toHaveBeenCalledWith('rappel-t2')
  })

  it('push en message de données, app en arrière-plan ou tuée : présenté par l’app', async () => {
    const reminder = { type: 'stock_reminder', notificationId: 'n-9', stationName: 'S' }
    const message = { notification: null, data: { dataString: JSON.stringify(reminder) } }
    expect(await run(message)).toBe(Notifications.BackgroundNotificationTaskResult.NewData)
    expect(presentPush).toHaveBeenCalledWith(reminder)
  })

  it('app au premier plan, ou type inconnu : rien à présenter (le toast suffit)', async () => {
    jest.mocked(presentPush).mockClear()
    const reminder = { notification: null, data: { dataString: '{"type":"stock_reminder"}' } }
    const state = Object.getOwnPropertyDescriptor(AppState, 'currentState')
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true })
    expect(await run(reminder)).toBe(Notifications.BackgroundNotificationTaskResult.NoData)
    if (state) Object.defineProperty(AppState, 'currentState', state)
    expect(await run({ notification: null, data: { dataString: '{"type":"promo"}' } })).toBe(
      Notifications.BackgroundNotificationTaskResult.NoData,
    )
    expect(presentPush).not.toHaveBeenCalled()
  })
})
