import type { Tabs } from 'expo-router'
import { Bell, Heart, type LucideIcon, Map, UserRound } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { t } from '@/i18n'
import { cn } from '@/lib/cn'
import { haptics } from '@/lib/haptics'
import { useTheme } from '@/theme/theme'

import { Text } from './ui/text'

/** Props de la barre d'onglets (type de React Navigation, embarqué par Expo Router). */
type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0]

const ICONS: Record<string, LucideIcon> = { index: Map, favorites: Heart, inbox: Bell, account: UserRound }
const LABELS: Record<string, string> = {
  index: t.tabs.map,
  favorites: t.tabs.favorites,
  inbox: t.tabs.inbox,
  account: t.tabs.account,
}

export const TAB_BAR_HEIGHT = 64

/**
 * Barre d'onglets (4 entrées, libellés toujours visibles) : indicateur en pastille derrière
 * l'icône active, cibles pleine hauteur, badge de non-lus annoncé avec le libellé.
 */
export function TabBar({ state, navigation, badges }: BottomTabBarProps & { badges?: Record<string, number> }) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  return (
    <View
      accessibilityRole="tablist"
      className="flex-row border-t border-border bg-surface"
      style={{ paddingBottom: insets.bottom, height: TAB_BAR_HEIGHT + insets.bottom }}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index
        const Icon = ICONS[route.name] ?? Map
        const label = LABELS[route.name] ?? route.name
        const badge = badges?.[route.name] ?? 0
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={badge > 0 ? `${label}, ${badge}` : label}
            accessibilityState={{ selected: focused }}
            testID={`tab-${route.name}`}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
              if (!focused && !event.defaultPrevented) {
                haptics.selection()
                navigation.navigate(route.name, route.params)
              }
            }}
            className="flex-1 items-center justify-center gap-1"
          >
            <View className={cn('h-8 w-16 items-center justify-center rounded-full', focused && 'bg-primary-subtle')}>
              <Icon
                size={22}
                color={focused ? colors['brand-text'] : colors['muted-foreground']}
                strokeWidth={focused ? 2.4 : 2}
              />
              {badge > 0 && (
                <View className="absolute right-3 top-0 h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-surface bg-primary px-1">
                  <Text
                    variant="caption"
                    weight="bold"
                    tone="onPrimary"
                    style={{ fontSize: 10, lineHeight: 12 }}
                    maxFontSizeMultiplier={1.2}
                  >
                    {badge > 99 ? '99+' : badge}
                  </Text>
                </View>
              )}
            </View>
            <Text
              variant="caption"
              weight={focused ? 'semibold' : 'medium'}
              tone={focused ? 'brand' : 'muted'}
              maxFontSizeMultiplier={1.3}
            >
              {label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
