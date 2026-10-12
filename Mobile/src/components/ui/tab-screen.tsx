import { type ReactNode } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text } from './text'

/** Écran d'onglet : grand titre en tête, action facultative à droite, contenu libre. */
export function TabScreen({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="min-h-16 flex-row items-center justify-between gap-3 px-5 pb-2 pt-3">
        <Text variant="title1" accessibilityRole="header">
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  )
}
