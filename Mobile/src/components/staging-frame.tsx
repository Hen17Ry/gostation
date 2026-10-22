import { FlaskConical } from 'lucide-react-native'
import { type ReactNode } from 'react'
import { View } from 'react-native'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text } from '@/components/ui/text'
import { t } from '@/i18n'
import { isStaging } from '@/lib/app-env'
import { useTheme } from '@/theme/theme'

/**
 * Bandeau « Staging » sous la barre d'état, au-dessus de tous les écrans (builds `preview`). Les
 * écrans placent leur haut d'après useSafeAreaInsets() : ils reçoivent ici une marge haute nulle,
 * le bandeau occupant déjà la zone de la barre d'état. Rien en production.
 */
export function StagingFrame({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  if (!isStaging()) return children
  return (
    <View className="flex-1 bg-background">
      <View style={{ paddingTop: insets.top }}>
        <View
          testID="staging-banner"
          accessible
          accessibilityRole="text"
          accessibilityLabel={`${t.env.staging} : ${t.env.stagingDescription}`}
          className="min-h-7 flex-row items-center justify-center gap-1.5 bg-info px-4 py-1"
        >
          <FlaskConical size={14} color={colors['info-foreground']} strokeWidth={2.2} />
          <Text
            variant="caption"
            weight="semibold"
            maxFontSizeMultiplier={1.5}
            style={{ color: colors['info-foreground'] }}
          >
            {`${t.env.staging} · ${t.env.stagingDescription}`}
          </Text>
        </View>
      </View>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>{children}</SafeAreaInsetsContext.Provider>
    </View>
  )
}
