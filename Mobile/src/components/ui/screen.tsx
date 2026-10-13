import { router } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { type ReactNode } from 'react'
import { KeyboardAvoidingView, View } from 'react-native'
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { t } from '@/i18n'
import { AnimatedView } from '@/lib/animated'
import { cn } from '@/lib/cn'

import { IconButton } from './icon-button'
import { Text } from './text'

/**
 * Écran standard : zones sûres respectées, en-tête (retour + titre h1), contenu défilant avec
 * marges de 20 dp, clavier pris en compte, pied collant facultatif (bouton principal). Quand le
 * grand titre sort de l'écran, un titre compact (`compactTitle`, par défaut `title`) apparaît dans
 * la barre, sur le thread UI.
 */
export function Screen({
  title,
  compactTitle = title,
  subtitle,
  back = true,
  children,
  footer,
  scroll = true,
  headerRight,
  className,
}: {
  title?: string
  /** Titre de la barre une fois le grand titre défilé (écrans dont le titre est dans le contenu). */
  compactTitle?: string
  subtitle?: string
  back?: boolean
  children: ReactNode
  footer?: ReactNode
  scroll?: boolean
  headerRight?: ReactNode
  className?: string
}) {
  const insets = useSafeAreaInsets()
  const scrollY = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y
  })
  const compactStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [16, 40], [0, 1], Extrapolation.CLAMP),
  }))
  const body = <View className={cn('gap-5 px-5 pb-6', !scroll && 'flex-1', className)}>{children}</View>
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      // Edge-to-edge (Android 15+) : la fenêtre n'est plus redimensionnée par le clavier ; le padding
      // garde le pied d'écran (bouton principal) visible au-dessus du clavier sur les deux plateformes.
      behavior="padding"
      style={{ paddingTop: insets.top }}
    >
      {(back || title || headerRight) && (
        <View className="min-h-14 flex-row items-center gap-1 px-2">
          {back && router.canGoBack() && (
            <IconButton icon={ArrowLeft} label={t.common.back} onPress={() => router.back()} />
          )}
          <AnimatedView
            className="flex-1 px-2"
            style={compactStyle}
            // Doublon visuel du grand titre : les lecteurs d'écran ne l'annoncent pas deux fois.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {scroll && compactTitle && (
              <Text variant="headline" numberOfLines={1}>
                {compactTitle}
              </Text>
            )}
          </AnimatedView>
          {headerRight}
        </View>
      )}
      {scroll ? (
        <Animated.ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1 }}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {title && <Header title={title} subtitle={subtitle} />}
          {body}
        </Animated.ScrollView>
      ) : (
        <View className="flex-1">
          {title && <Header title={title} subtitle={subtitle} />}
          {body}
        </View>
      )}
      {footer && (
        <View
          className="border-t border-border bg-background px-5 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          {footer}
        </View>
      )}
    </KeyboardAvoidingView>
  )
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="gap-1.5 px-5 pb-5 pt-1">
      <Text variant="title1" accessibilityRole="header">
        {title}
      </Text>
      {subtitle && (
        <Text variant="callout" tone="muted">
          {subtitle}
        </Text>
      )}
    </View>
  )
}
