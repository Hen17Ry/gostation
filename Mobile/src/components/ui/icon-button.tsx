import type { LucideIcon } from 'lucide-react-native'
import { type PressableProps, type StyleProp, type ViewStyle } from 'react-native'

import { cn } from '@/lib/cn'
import { elevation } from '@/theme/elevation'
import { useTheme } from '@/theme/theme'

import { PressableScale } from './pressable-scale'

/**
 * Bouton icône : cible de 48 dp, nom accessible obligatoire, état pressé/sélectionné annoncé.
 * `floating` : bouton posé sur la carte (surface élevée).
 */
export function IconButton({
  icon: Icon,
  label,
  selected,
  filled = false,
  floating = false,
  tone = 'default',
  className,
  ...props
}: Omit<PressableProps, 'children' | 'style'> & {
  style?: StyleProp<ViewStyle>
  icon: LucideIcon
  label: string
  selected?: boolean
  /** Icône pleine quand sélectionnée (cœur d'un favori). */
  filled?: boolean
  floating?: boolean
  tone?: 'default' | 'brand' | 'muted'
  className?: string
}) {
  const { colors } = useTheme()
  const color =
    selected || tone === 'brand'
      ? colors['brand-text']
      : tone === 'muted'
        ? colors['muted-foreground']
        : colors.foreground
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      className={cn(
        'h-12 w-12 items-center justify-center rounded-full',
        floating && 'bg-popover',
        selected && 'bg-primary-subtle',
        className,
      )}
      style={floating ? elevation(2) : undefined}
      {...props}
    >
      <Icon size={22} color={color} strokeWidth={2} fill={filled && selected ? color : 'none'} />
    </PressableScale>
  )
}
