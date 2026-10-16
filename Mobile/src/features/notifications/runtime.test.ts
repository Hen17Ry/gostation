import { QueryClient } from '@tanstack/react-query'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'

import { markNotificationsRead } from '@/api/account'
import { managerKeys, meKeys } from '@/api/keys'
import { confirmStocks } from '@/api/manager'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'

import { ACTION_CONFIRM, ACTION_UPDATE } from './channels'
import { onForegroundPush, onPushResponse } from './runtime'

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('@/components/ui/toast', () => ({ toast: { success: jest.fn(), info: jest.fn(), error: jest.fn() } }))
jest.mock('@/api/client', () => ({ session: { load: jest.fn(async () => true) } }))
jest.mock('@/api/account', () => ({ markNotificationsRead: jest.fn(async () => undefined) }))
jest.mock('@/api/manager', () => ({
  loadStocks: jest.fn(async () => ({ etag: 'W/"3"' })),
  confirmStocks: jest.fn(async () => undefined),
}))

const notification = (identifier: string, data: Record<string, unknown>) =>
  ({ request: { identifier, content: { title: null, body: null, data } } }) as unknown as Notifications.Notification
const response = (identifier: string, data: Record<string, unknown>, actionIdentifier = ACTION_UPDATE) =>
  ({ actionIdentifier, notification: notification(identifier, data) }) as Notifications.NotificationResponse

let qc: QueryClient
beforeEach(() => {
  jest.clearAllMocks()
  qc = new QueryClient()
  jest.spyOn(qc, 'invalidateQueries')
})

describe('push reçu app ouverte', () => {
  it('toast composé localement et boîte de réception rechargée, sans notification système', () => {
    onForegroundPush(qc, notification('p1', { type: 'back_in_stock', stationName: 'Station Zongo', product: 'gas' }))
    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: meKeys.notifications() })
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('rappel : recharge aussi l’espace gérant ; décision : le profil', () => {
    onForegroundPush(qc, notification('p2', { type: 'stock_reminder' }))
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: managerKeys.all })
    onForegroundPush(qc, notification('p3', { type: 'station_decision', decision: 'approved' }))
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: meKeys.profile() })
  })

  it('confirmation locale ou type inconnu : rien', () => {
    onForegroundPush(qc, notification('p4', { local: 'confirmation' }))
    onForegroundPush(qc, notification('p5', { type: 'promo' }))
    expect(toast.info).not.toHaveBeenCalled()
    expect(qc.invalidateQueries).not.toHaveBeenCalled()
  })
})

describe('notification touchée', () => {
  it('ouvre l’écran du type et marque la notification lue', async () => {
    await onPushResponse(qc, response('r1', { type: 'station_reported', notificationId: 'n-1' }))
    expect(router.push).toHaveBeenCalledWith('/manager/reports')
    expect(markNotificationsRead).toHaveBeenCalledWith({ ids: ['n-1'] })
  })

  it('décision : profil relu (espace du compte) avant d’ouvrir le statut', async () => {
    const navigate = jest.fn()
    await onPushResponse(qc, response('r1c', { type: 'station_decision', decision: 'rejected' }), navigate)
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: meKeys.profile() })
    expect(navigate).toHaveBeenCalledWith('/manager/status')
  })

  it('lancement à froid : le lien est remis à la navigation différée, pas au routeur', async () => {
    const navigate = jest.fn()
    await onPushResponse(qc, response('r1b', { type: 'station_decision', decision: 'suspended' }), navigate)
    expect(navigate).toHaveBeenCalledWith('/manager/status')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('même réponse vue deux fois (écouteur et dernière réponse) : traitée une fois', async () => {
    await onPushResponse(qc, response('r2', { type: 'stock_reminder' }))
    await onPushResponse(qc, response('r2', { type: 'stock_reminder' }))
    expect(router.push).toHaveBeenCalledTimes(1)
  })

  it('« Rien n’a changé » app au premier plan : confirme, retire le rappel, toast', async () => {
    await onPushResponse(qc, response('r3', { type: 'stock_reminder' }, ACTION_CONFIRM))
    expect(confirmStocks).toHaveBeenCalledWith('W/"3"')
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('r3')
    expect(toast.success).toHaveBeenCalledWith(t.push.confirmedToast)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('« Rien n’a changé » en échec : toast d’erreur', async () => {
    jest.mocked(confirmStocks).mockRejectedValueOnce(new Error('network'))
    await onPushResponse(qc, response('r4', { type: 'stock_reminder' }, ACTION_CONFIRM))
    expect(toast.error).toHaveBeenCalledWith(t.push.confirmFailedBody)
  })
})
