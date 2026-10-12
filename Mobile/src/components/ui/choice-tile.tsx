import type { LucideIcon } from 'lucide-react-native'
import { View } from 'react-native'

import { haptics } from '@/lib/haptics'
import { cn } from '@/lib/cn'
import { useTheme } from '@/theme/theme'

import { PressableScale } from './pressable-scale'
import { Text } from './text'

/**
 * Grand bouton de choix (produit : Gaz, Essence, Gasoil) : 88 dp de haut, icône, libellé et
 * précision ; sélection indiquée par la couleur, le contour et l'état annoncé (radio).
 */
export function ChoiceTile({
  icon: Icon,
  label,
  hint,
  selected,
  onPress,
  testID,
}: {
  icon: LucideIcon
  label: string
  hint?: string
  selected: boolean
  onPress: () => void
  testID?: string
}) {
  const { colors } = useTheme()
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
      accessibilityState={{ selected, checked: selected }}
      onPress={() => {
        if (!selected) haptics.selection()
        onPress()
      }}
      className={cn(
        'h-[88px] flex-1 items-center justify-center gap-1.5 rounded-xl border',
        selected ? 'border-primary bg-primary-subtle' : 'border-border bg-surface',
      )}
      style={selected ? { borderWidth: 2 } : undefined}
    >
      <View className={cn('h-9 w-9 items-center justify-center rounded-full', selected ? 'bg-primary' : 'bg-muted')}>
        <Icon
          size={20}
          color={selected ? colors['primary-foreground'] : colors['muted-foreground']}
          strokeWidth={2.2}
        />
      </View>
      <Text variant="subhead" weight="semibold" tone={selected ? 'brand' : 'default'}>
        {label}
      </Text>
    </PressableScale>
  )
}

/** Puce de choix (taille de bouteille) : 44 dp de haut, zone tactile élargie à 48 dp. */
export function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string
  selected: boolean
  onPress: () => void
  testID?: string
}) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      hitSlop={4}
      onPress={() => {
        if (!selected) haptics.selection()
        onPress()
      }}
      className={cn(
        'h-11 min-w-[72px] items-center justify-center rounded-full border px-4',
        selected ? 'border-primary bg-primary' : 'border-border-strong bg-surface',
      )}
    >
      <Text variant="subhead" weight="semibold" tone={selected ? 'onPrimary' : 'default'}>
        {label}
      </Text>
    </PressableScale>
  )
}
