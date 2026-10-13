import { ChevronRight, type LucideIcon } from 'lucide-react-native'
import { type ReactNode } from 'react'
import { Pressable, Switch, View } from 'react-native'

import { haptics } from '@/lib/haptics'
import { useTheme } from '@/theme/theme'
import { tokens } from '@/theme/tokens.generated'

import { Text } from './text'

/** Ligne de liste pressable (≥ 56 dp) : icône, titre, sous-titre, élément de fin ou chevron. */
export function ListRow({
  icon: Icon,
  title,
  subtitle,
  onPress,
  trailing,
  destructive,
  testID,
}: {
  testID?: string
  icon?: LucideIcon
  title: string
  subtitle?: string
  onPress?: () => void
  trailing?: ReactNode
  destructive?: boolean
}) {
  const { colors } = useTheme()
  const content = (
    <View className="min-h-14 flex-row items-center gap-3.5 px-4 py-3">
      {Icon && <Icon size={22} color={destructive ? colors.destructive : colors['muted-foreground']} strokeWidth={2} />}
      <View className="flex-1 gap-0.5">
        <Text variant="body" weight="medium" tone={destructive ? 'destructive' : 'default'}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="footnote" tone="muted">
            {subtitle}
          </Text>
        )}
      </View>
      {trailing ?? (onPress && <ChevronRight size={20} color={colors['muted-foreground']} />)}
    </View>
  )
  if (!onPress) return content
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      android_ripple={{ color: colors.accent }}
    >
      {content}
    </Pressable>
  )
}

/** Interrupteur avec libellé (la ligne entière est la cible). */
export function SwitchRow({
  title,
  subtitle,
  value,
  onValueChange,
  disabled,
}: {
  title: string
  subtitle?: string
  value: boolean
  onValueChange: (v: boolean) => void
  disabled?: boolean
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => {
        haptics.selection()
        onValueChange(!value)
      }}
      android_ripple={{ color: colors.accent }}
      className="min-h-14 flex-row items-center gap-3 px-4 py-3"
    >
      <View className="flex-1 gap-0.5">
        <Text variant="body" weight="medium">
          {title}
        </Text>
        {subtitle && (
          <Text variant="footnote" tone="muted">
            {subtitle}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(v) => {
          haptics.selection()
          onValueChange(v)
        }}
        trackColor={{ false: colors.input, true: colors.primary }}
        // Pouce clair dans les deux thèmes : sur fond sombre, la couleur de surface le rendait invisible.
        thumbColor={tokens.neutral[50]}
        importantForAccessibility="no"
      />
    </Pressable>
  )
}
