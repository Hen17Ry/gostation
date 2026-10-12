import { CircleAlert, CircleCheck, Info, type LucideIcon, TriangleAlert } from 'lucide-react-native'
import { type ReactNode } from 'react'
import { View } from 'react-native'

import { cn } from '@/lib/cn'
import { useTheme } from '@/theme/theme'

import { Text } from './text'

type Tone = 'info' | 'warning' | 'danger' | 'success'

const BOX: Record<Tone, string> = {
  info: 'bg-info-subtle',
  warning: 'bg-warning-subtle',
  danger: 'bg-danger-subtle',
  success: 'bg-success-subtle',
}
const ICON: Record<Tone, LucideIcon> = { info: Info, warning: TriangleAlert, danger: CircleAlert, success: CircleCheck }
const FG = {
  info: 'info-subtle-foreground',
  warning: 'warning-subtle-foreground',
  danger: 'danger-subtle-foreground',
  success: 'success-subtle-foreground',
} as const

/** Message en ligne (hors connexion, trajets estimés, erreur de formulaire…), annoncé si urgent. */
export function Banner({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: Tone
  title?: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const { colors } = useTheme()
  const Icon = ICON[tone]
  const fg = colors[FG[tone]]
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : 'summary'}
      accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
      className={cn('flex-row gap-3 rounded-lg px-3.5 py-3', BOX[tone], className)}
    >
      <Icon size={18} color={fg} strokeWidth={2.2} style={{ marginTop: 2 }} />
      <View className="flex-1 gap-0.5">
        {title && (
          <Text variant="subhead" weight="semibold" style={{ color: fg }}>
            {title}
          </Text>
        )}
        {typeof children === 'string' ? (
          <Text variant="footnote" style={{ color: fg }}>
            {children}
          </Text>
        ) : (
          children
        )}
        {action && <View className="mt-1.5 flex-row">{action}</View>}
      </View>
    </View>
  )
}
