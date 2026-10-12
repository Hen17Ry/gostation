import { Platform, type ViewStyle } from 'react-native'

/**
 * Élévations natives (mêmes niveaux que le web) : 1 cartes, 2 panneaux flottants et boutons de
 * carte, 3 feuilles et dialogues. Android : `elevation` (ombre du système) ; iOS : ombre douce.
 * En sombre, la hiérarchie passe aussi par la surface (card < popover).
 */
export function elevation(level: 0 | 1 | 2 | 3): ViewStyle {
  if (level === 0) return {}
  return Platform.select<ViewStyle>({
    android: { elevation: [0, 2, 6, 12][level] },
    default: {
      shadowColor: '#2b1d14',
      shadowOpacity: [0, 0.06, 0.12, 0.2][level],
      shadowRadius: [0, 3, 12, 24][level],
      shadowOffset: { width: 0, height: [0, 1, 4, 10][level]! },
    },
  })!
}
