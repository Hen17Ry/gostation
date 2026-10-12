import type { LucideIcon } from 'lucide-react-native'
import { View } from 'react-native'

import { cn } from '@/lib/cn'
import { useTheme } from '@/theme/theme'

import { Text } from './text'

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

const BOX: Record<BadgeTone, string> = {
  neutral: 'bg-secondary',
  brand: 'bg-primary-subtle',
  success: 'bg-success-subtle',
  warning: 'bg-warning-subtle',
  danger: 'bg-danger-subtle',
  info: 'bg-info-subtle',
}
const FG = {
  neutral: 'secondary-foreground',
  brand: 'primary-subtle-foreground',
  success: 'success-subtle-foreground',
  warning: 'warning-subtle-foreground',
  danger: 'danger-subtle-foreground',
  info: 'info-subtle-foreground',
} as const
const TEXT: Record<BadgeTone, string> = {
  neutral: 'text-secondary-foreground',
  brand: 'text-primary-subtle-foreground',
  success: 'text-success-subtle-foreground',
  warning: 'text-warning-subtle-foreground',
  danger: 'text-danger-subtle-foreground',
  info: 'text-info-subtle-foreground',
}

/** Badge de statut : fond teinté + texte ≥ 4,5:1, toujours avec un libellé (jamais la couleur seule). */
export function Badge({
  label,
  tone = 'neutral',
  icon: Icon,
  className,
}: {
  label: string
  tone?: BadgeTone
  icon?: LucideIcon
  className?: string
}) {
  const { colors } = useTheme()
  return (
    <View className={cn('flex-row items-center gap-1 self-start rounded-full px-2 py-0.5', BOX[tone], className)}>
      {Icon && <Icon size={12} color={colors[FG[tone]]} strokeWidth={2.4} />}
      <Text variant="caption" weight="semibold" className={TEXT[tone]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}
