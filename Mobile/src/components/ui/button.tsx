import type { LucideIcon } from 'lucide-react-native'
import { type PressableProps, type StyleProp, View, type ViewStyle } from 'react-native'

import { cn } from '@/lib/cn'
import { useTheme } from '@/theme/theme'

import { PressableScale } from './pressable-scale'
import { Spinner } from './spinner'
import { Text, type TextTone } from './text'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
type Size = 'md' | 'lg' | 'sm'

const BOX: Record<Variant, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  outline: 'border border-border-strong bg-surface',
  ghost: 'bg-transparent',
  destructive: 'bg-destructive',
  link: 'bg-transparent',
}
const TONE: Record<Variant, TextTone> = {
  primary: 'onPrimary',
  secondary: 'default',
  outline: 'default',
  ghost: 'brand',
  destructive: 'onPrimary',
  link: 'brand',
}
// Hauteurs ≥ 48 dp (cible tactile Android) ; « sm » garde 48 dp de zone grâce au hitSlop.
const SIZE: Record<Size, string> = {
  sm: 'h-10 px-4 rounded-md',
  md: 'h-12 px-5 rounded-lg',
  lg: 'h-14 px-6 rounded-xl',
}

const SQUARE: Record<Size, string> = { sm: 'w-10 px-0', md: 'w-12 px-0', lg: 'w-14 px-0' }

/**
 * Bouton : variantes aux tokens, état de chargement (indicateur + occupé annoncé), désactivé
 * lisible, icône facultative. Le libellé visible est aussi le nom accessible ; `iconOnly` : bouton
 * carré, icône seule, le libellé reste le nom lu par le lecteur d'écran.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  iconOnly = false,
  disabled,
  className,
  ...props
}: Omit<PressableProps, 'children' | 'style'> & {
  style?: StyleProp<ViewStyle>
  label: string
  variant?: Variant
  size?: Size
  icon?: LucideIcon
  loading?: boolean
  iconOnly?: boolean
  className?: string
}) {
  const { colors } = useTheme()
  const inactive = disabled || loading
  const tone = TONE[variant]
  const fg =
    tone === 'onPrimary' ? colors['primary-foreground'] : tone === 'brand' ? colors['brand-text'] : colors.foreground
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      disabled={inactive}
      hitSlop={variant === 'link' ? { top: 4, bottom: 4, left: 8, right: 8 } : size === 'sm' ? 4 : undefined}
      className={cn(
        'flex-row items-center justify-center gap-2',
        // Lien : aligné sur le texte voisin (pas de marge latérale), zone tactile élargie par hitSlop.
        variant === 'link' ? 'h-10 self-start px-0' : SIZE[size],
        iconOnly && SQUARE[size],
        BOX[variant],
        inactive && !loading && 'opacity-50',
        className,
      )}
      {...props}
    >
      {loading ? (
        <Spinner color={fg} size={size === 'lg' ? 22 : 20} />
      ) : (
        Icon && (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon size={size === 'lg' ? 22 : 20} color={fg} strokeWidth={2} />
          </View>
        )
      )}
      {!iconOnly && (
        <Text variant={size === 'sm' ? 'subhead' : 'headline'} weight="semibold" tone={tone} numberOfLines={1}>
          {label}
        </Text>
      )}
    </PressableScale>
  )
}
