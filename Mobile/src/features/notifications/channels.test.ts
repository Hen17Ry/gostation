import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { ACTION_CONFIRM, ACTION_UPDATE, CHANNELS, REMINDER_CATEGORY, setupNotificationChannels } from './channels'

describe('canaux et catégorie', () => {
  beforeAll(async () => {
    jest.replaceProperty(Platform, 'OS', 'android')
    await setupNotificationChannels()
  })

  it('crée les cinq canaux ; son par défaut du système, sauf les confirmations (muettes)', () => {
    const calls = jest.mocked(Notifications.setNotificationChannelAsync).mock.calls
    expect(calls.map(([id]) => id).sort()).toEqual(Object.values(CHANNELS).sort())
    for (const [id, options] of calls) {
      if (id === CHANNELS.confirmations) expect(options.sound).toBeNull()
      // « default » serait cherché comme un fichier son et rendrait le canal muet.
      else expect(options).not.toHaveProperty('sound')
    }
    const reminders = calls.find(([id]) => id === CHANNELS.reminders)?.[1]
    expect(reminders?.importance).toBe(Notifications.AndroidImportance.HIGH)
  })

  it('« Rien n’a changé » sans ouvrir l’app, « Mettre à jour » l’ouvre', () => {
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(REMINDER_CATEGORY, [
      expect.objectContaining({ identifier: ACTION_UPDATE, options: { opensAppToForeground: true } }),
      expect.objectContaining({ identifier: ACTION_CONFIRM, options: { opensAppToForeground: false } }),
    ])
  })
})
