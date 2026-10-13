import { View } from 'react-native'

import { cn } from '@/lib/cn'

export function Divider({ className }: { className?: string }) {
  return <View className={cn('h-px bg-border', className)} />
}
