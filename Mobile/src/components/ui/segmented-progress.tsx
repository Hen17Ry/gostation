import { View } from 'react-native'

import { cn } from '@/lib/cn'

import { Text } from './text'

/**
 * Progression d'un formulaire en étapes : un segment par étape (fait, en cours, à venir), « Étape
 * 2 sur 3 · Votre station » au-dessus. Annoncée comme barre de progression.
 */
export function SegmentedProgress({
  steps,
  current,
  label,
}: {
  steps: readonly string[]
  current: number
  /** « Étape 2 sur 3 ». */
  label: string
}) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}, ${steps[current]}`}
      accessibilityValue={{ min: 1, max: steps.length, now: current + 1 }}
      className="gap-2"
    >
      <View className="flex-row items-baseline justify-between gap-2">
        <Text variant="footnote" weight="semibold" tone="brand">
          {label}
        </Text>
        <Text variant="footnote" tone="muted" numberOfLines={1} className="flex-1 text-right">
          {steps[current]}
        </Text>
      </View>
      <View className="flex-row gap-1.5">
        {steps.map((s, i) => (
          <View key={s} className={cn('h-1.5 flex-1 rounded-full', i <= current ? 'bg-primary' : 'bg-secondary')} />
        ))}
      </View>
    </View>
  )
}
