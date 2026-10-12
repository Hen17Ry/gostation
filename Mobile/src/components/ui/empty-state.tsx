import { type ReactNode } from 'react'
import { View } from 'react-native'

import { cn } from '@/lib/cn'

import { Text } from './text'

/** État vide : illustration, titre, explication, action facultative. */
export function EmptyState({
  illustration,
  title,
  body,
  action,
  className,
}: {
  illustration?: ReactNode
  title: string
  body?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <View className={cn('items-center gap-3 px-6 py-10', className)}>
      {illustration}
      <View className="max-w-[320px] items-center gap-1.5">
        <Text variant="headline" className="text-center" accessibilityRole="header">
          {title}
        </Text>
        {body && (
          <Text variant="subhead" tone="muted" className="text-center">
            {body}
          </Text>
        )}
      </View>
      {action && <View className="mt-2 self-stretch">{action}</View>}
    </View>
  )
}
