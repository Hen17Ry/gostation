import * as Haptics from 'expo-haptics'

/**
 * Retours haptiques, avec parcimonie (jamais à chaque toucher) : sélection d'un choix, action
 * importante confirmée, alerte. Sans effet si l'appareil ne vibre pas.
 */
export const haptics = {
  selection: () => void Haptics.selectionAsync().catch(() => undefined),
  light: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  warning: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
  error: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined),
}
