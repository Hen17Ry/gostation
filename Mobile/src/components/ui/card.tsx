import { type ReactNode } from 'react'
import { View, type ViewProps } from 'react-native'

import { cn } from '@/lib/cn'
import { elevation } from '@/theme/elevation'

/**
 * Carte : surface élevée niveau 1, coins 16 dp, marge interne 16 dp. `flush` : sans marge interne,
 * pour les listes qui gèrent la leur (deux classes de padding en conflit ne se résolvent pas par
 * leur ordre dans `className`).
 */
export function Card({
  children,
  className,
  style,
  flush = false,
  ...props
}: ViewProps & { children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <View
      className={cn('rounded-xl border border-border bg-card', !flush && 'p-4', className)}
      style={[elevation(1), style]}
      {...props}
    >
      {children}
    </View>
  )
}
