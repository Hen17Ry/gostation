import * as Notifications from 'expo-notifications'

import { t } from '@/i18n'

import { CHANNELS, REMINDER_CATEGORY } from './channels'
import { presentPush, pushText, remoteData } from './present'

describe('push reçu en message de données (Android)', () => {
  it('lit les données du push Expo dans dataString', () => {
    expect(remoteData({ data: { dataString: '{"type":"stock_reminder","stationName":"S"}' } })).toEqual({
      type: 'stock_reminder',
      stationName: 'S',
    })
    expect(remoteData({ data: { dataString: '{oops' } })).toBeNull()
    expect(remoteData({ data: {} })).toBeNull()
    expect(remoteData(null)).toBeNull()
  })

  it('rappel : présenté avec sa catégorie, sur le canal du serveur, texte composé localement', async () => {
    const data = {
      type: 'stock_reminder',
      notificationId: 'n-1',
      stationName: 'Station Zongo',
      hoursSinceUpdate: 5,
      channelId: CHANNELS.reminders,
    }
    await presentPush(data)
    expect(Notifications.scheduleNotificationAsync).toHaveBeenLastCalledWith({
      identifier: 'n-1',
      content: {
        title: t.push.reminder.title,
        body: t.push.reminder.body('Station Zongo', 5),
        data,
        categoryIdentifier: REMINDER_CATEGORY,
      },
      trigger: { channelId: CHANNELS.reminders },
    })
    expect(t.push.reminder.body('Station Zongo', 5)).toContain('il y a 5\u00a0h')
    expect(t.push.reminder.body('Station Zongo', null)).toContain('renseignez vos stocks')
  })

  it('autres types : sans catégorie ; canal inconnu ou absent : celui du type', async () => {
    await presentPush({ type: 'back_in_stock', notificationId: 'n-2', stationName: 'S', productLabel: 'Essence' })
    const [request] = jest.mocked(Notifications.scheduleNotificationAsync).mock.lastCall!
    expect(request.trigger).toEqual({ channelId: CHANNELS.alerts })
    expect(request.content).not.toHaveProperty('categoryIdentifier')
    expect(request.content.title).toBe(t.push.backInStock.title)
    await presentPush({ type: 'station_reported', channelId: 'bogus', stationName: 'S' })
    expect(jest.mocked(Notifications.scheduleNotificationAsync).mock.lastCall![0].trigger).toEqual({
      channelId: CHANNELS.reports,
    })
  })

  it('type inconnu : rien', async () => {
    jest.mocked(Notifications.scheduleNotificationAsync).mockClear()
    await presentPush({ type: 'promo' })
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it.each([
    [
      { reason: 'out_of_stock', reporters: 3, productLabel: 'Essence' },
      'Station signalée',
      '3\u00a0utilisateurs signalent une rupture à « S » : Essence.',
    ],
    [{ reason: 'station_closed', reporters: 3 }, 'Station signalée', '« S » comme fermée'],
    [{ reason: 'wrong_location', reporters: 4 }, 'Station signalée', 'position incorrecte'],
    [
      { level: 'excluded', reporters: 5 },
      'Station masquée dans la recherche',
      'n’apparaît plus dans la recherche après 5\u00a0signalements',
    ],
    [
      { level: 'excluded', reporters: 5, productLabel: 'Gasoil' },
      'Station masquée dans la recherche',
      'n’apparaît plus pour Gasoil',
    ],
  ])('signalements %j', (data, title, body) => {
    const text = pushText('station_reported', { stationName: 'S', ...data })
    expect(text.title).toBe(title)
    expect(text.body).toContain(body)
  })

  it('décision : titre par décision, jamais le motif', () => {
    const text = pushText('station_decision', { stationName: 'S', decision: 'suspended', reason: 'secret' })
    expect(text.title).toBe('Station suspendue')
    expect(text.body).not.toContain('secret')
    expect(pushText('station_decision', { stationName: 'S', decision: 'bogus' }).title).toBe('GoStation')
  })
})
