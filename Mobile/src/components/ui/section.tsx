import { type ReactNode } from 'react'
import { View } from 'react-native'

import { cn } from '@/lib/cn'

import { Text } from './text'

/**
 * Groupe de lignes sur une carte, avec un intitulé discret. `bare` : intitulé seul, le contenu
 * (ses propres cartes, des filtres, un texte d'aide) est empilé sans carte commune.
 */
export function Section({
  title,
  children,
  className,
  bare = false,
}: {
  title?: string
  children: ReactNode
  className?: string
  bare?: boolean
}) {
  return (
    <View className={cn('gap-2', className)}>
      {title && (
        <Text
          variant="footnote"
          weight="semibold"
          tone="muted"
          className="px-1 uppercase tracking-wide"
          accessibilityRole="header"
        >
          {title}
        </Text>
      )}
      {bare ? (
        <View className="gap-3">{children}</View>
      ) : (
        <View className="overflow-hidden rounded-xl border border-border bg-card">{children}</View>
      )}
    </View>
  )
}
