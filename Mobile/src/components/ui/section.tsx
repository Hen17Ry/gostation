import { type ReactNode } from 'react'
import { View } from 'react-native'

import { cn } from '@/lib/cn'

import { Text } from './text'

/** Groupe de lignes sur une carte, avec un intitulé discret. */
export function Section({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
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
      <View className="overflow-hidden rounded-xl border border-border bg-card">{children}</View>
    </View>
  )
}
