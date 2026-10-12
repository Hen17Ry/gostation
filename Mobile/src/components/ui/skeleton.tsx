import { useEffect } from 'react'
import { type DimensionValue } from 'react-native'
import { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

import { AnimatedView } from '@/lib/animated'
import { cn } from '@/lib/cn'

/**
 * Squelette aux dimensions du contenu final (pas de saut de mise en page), pulsation d'opacité sur
 * le thread UI ; fixe si l'utilisateur réduit les animations.
 */
export function Skeleton({
  width,
  height,
  className,
}: {
  width?: DimensionValue
  height?: DimensionValue
  className?: string
}) {
  const reduced = useReducedMotion()
  const opacity = useSharedValue(1)
  useEffect(() => {
    if (!reduced) opacity.value = withRepeat(withTiming(0.45, { duration: 800 }), -1, true)
  }, [opacity, reduced])
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))
  return (
    <AnimatedView
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn('rounded-md bg-muted', className)}
      style={[{ width, height }, style]}
    />
  )
}
