import { Pressable, View } from 'react-native'

import { cn } from '@/lib/cn'
import { haptics } from '@/lib/haptics'

import { Text } from './text'

/**
 * Choix exclusif en carte (motif, type de demande) : libellé, précision, rond de sélection ;
 * 64 dp de haut au moins, état annoncé (radio). À placer dans une vue `radiogroup`.
 */
export function RadioCard({
  label,
  hint,
  selected,
  onPress,
  testID,
}: {
  label: string
  hint?: string
  selected: boolean
  onPress: () => void
  testID?: string
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={() => {
        if (!selected) haptics.selection()
        onPress()
      }}
      className={cn(
        'min-h-16 flex-row items-center gap-3 rounded-xl border px-4 py-3',
        selected ? 'border-primary bg-primary-subtle' : 'border-border bg-surface',
      )}
      style={selected ? { borderWidth: 2, paddingHorizontal: 15 } : undefined}
    >
      <View
        className={cn(
          'h-5 w-5 items-center justify-center rounded-full border-2',
          selected ? 'border-primary' : 'border-input',
        )}
      >
        {selected && <View className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="body" weight="semibold">
          {label}
        </Text>
        {hint && (
          <Text variant="footnote" tone="muted">
            {hint}
          </Text>
        )}
      </View>
    </Pressable>
  )
}
