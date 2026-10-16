import * as Notifications from 'expo-notifications'

import { ApiError } from '@/api/errors'
import { confirmStocks, loadStocks } from '@/api/manager'
import { t } from '@/i18n'

import { CHANNELS } from './channels'
import { claimResponse, confirmFromNotification, confirmUnchangedStocks, responseKey } from './confirm'

jest.mock('@/api/client', () => ({ session: { load: jest.fn(async () => true) } }))
jest.mock('@/api/manager', () => ({
  loadStocks: jest.fn(async () => ({ etag: 'W/"7"' })),
  confirmStocks: jest.fn(async () => undefined),
}))

const deps = (over: Partial<Parameters<typeof confirmUnchangedStocks>[0]> = {}) => ({
  hasSession: jest.fn(async () => true),
  load: jest.fn(async () => ({ etag: 'W/"7"' })),
  confirm: jest.fn(async () => undefined),
  ...over,
})

describe('« Rien n’a changé » : confirmation des stocks', () => {
  it('confirme avec la version courante (If-Match)', async () => {
    const d = deps()
    expect(await confirmUnchangedStocks(d)).toBe('confirmed')
    expect(d.confirm).toHaveBeenCalledWith('W/"7"')
  })

  it('version changée entre la lecture et l’envoi (412) : relit et réessaie une fois', async () => {
    const d = deps({
      load: jest.fn().mockResolvedValueOnce({ etag: 'W/"7"' }).mockResolvedValueOnce({ etag: 'W/"8"' }),
      confirm: jest
        .fn()
        .mockRejectedValueOnce(new ApiError({ status: 412, code: 'precondition.failed' }))
        .mockResolvedValueOnce(undefined),
    })
    expect(await confirmUnchangedStocks(d)).toBe('confirmed')
    expect(d.confirm).toHaveBeenLastCalledWith('W/"8"')
  })

  it('deux 412 de suite : échec', async () => {
    const d = deps({ confirm: jest.fn(async () => Promise.reject(new ApiError({ status: 412, code: 'x' }))) })
    expect(await confirmUnchangedStocks(d)).toBe('failed')
    expect(d.confirm).toHaveBeenCalledTimes(2)
  })

  it('sans session, ou session refusée (401/403) : déconnecté', async () => {
    expect(await confirmUnchangedStocks(deps({ hasSession: async () => false }))).toBe('signed-out')
    const refused = deps({ load: jest.fn(async () => Promise.reject(new ApiError({ status: 401, code: 'auth' }))) })
    expect(await confirmUnchangedStocks(refused)).toBe('signed-out')
  })

  it('réseau ou serveur en échec : échec', async () => {
    const d = deps({ load: jest.fn(async () => Promise.reject(new ApiError({ status: 0, code: 'network.error' }))) })
    expect(await confirmUnchangedStocks(d)).toBe('failed')
  })
})

describe('réponse traitée une seule fois', () => {
  it('tâche de fond puis dernière réponse au lancement : la seconde est ignorée', () => {
    const r = { actionIdentifier: 'confirm', notification: { request: { identifier: 'n-claim' } } }
    expect(claimResponse(responseKey(r))).toBe(true)
    expect(claimResponse(responseKey(r))).toBe(false)
    expect(claimResponse(responseKey({ ...r, actionIdentifier: 'update' }))).toBe(true)
  })
})

describe('action en arrière-plan', () => {
  beforeEach(() => jest.clearAllMocks())

  it('succès : retire le rappel et pose une notification discrète', async () => {
    expect(await confirmFromNotification('rappel-1')).toBe('confirmed')
    expect(loadStocks).toHaveBeenCalled()
    expect(confirmStocks).toHaveBeenCalledWith('W/"7"')
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('rappel-1')
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: t.push.confirmed, body: t.push.confirmedBody, data: { local: 'confirmation' } },
      trigger: { channelId: CHANNELS.confirmations },
    })
  })

  it('échec : invitation à ouvrir l’app, routée vers Stocks', async () => {
    jest.mocked(confirmStocks).mockRejectedValueOnce(new ApiError({ status: 503, code: 'server' }))
    expect(await confirmFromNotification('rappel-2')).toBe('failed')
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: {
        title: t.push.confirmFailed,
        body: t.push.confirmFailedBody,
        data: { local: 'confirmation', type: 'stock_reminder' },
      },
      trigger: { channelId: CHANNELS.reminders },
    })
  })
})
