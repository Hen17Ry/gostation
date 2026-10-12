import { router } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { type ReactNode } from 'react'
import { KeyboardAvoidingView, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { t } from '@/i18n'
import { cn } from '@/lib/cn'

import { IconButton } from './icon-button'
import { Text } from './text'

/**
 * Écran standard : zones sûres respectées, en-tête (retour + titre h1), contenu défilant avec
 * marges de 20 dp, clavier pris en compte, pied collant facultatif (bouton principal).
 */
export function Screen({
  title,
  subtitle,
  back = true,
  children,
  footer,
  scroll = true,
  headerRight,
  className,
}: {
  title?: string
  subtitle?: string
  back?: boolean
  children: ReactNode
  footer?: ReactNode
  scroll?: boolean
  headerRight?: ReactNode
  className?: string
}) {
  const insets = useSafeAreaInsets()
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
          <View className="flex-1" />
          {headerRight}
        </View>
      )}
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
          {title && <Header title={title} subtitle={subtitle} />}
          {body}
        </ScrollView>
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
