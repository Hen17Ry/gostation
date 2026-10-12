import { type ReactNode } from 'react'
import { type PressableProps } from 'react-native'
import { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated'

import { AnimatedPressable, type AnimatedStyleProp } from '@/lib/animated'
import { PRESSED_SCALE, spring } from '@/theme/motion'

/**
 * Zone pressable avec retour visuel immédiat : légère réduction (ressort sur le thread UI, sans
 * décaler la mise en page), coupée si l'utilisateur réduit les animations.
 */
export function PressableScale({
  children,
  style,
  scale = PRESSED_SCALE,
  className,
  ...props
}: Omit<PressableProps, 'style'> & {
  children: ReactNode
  style?: AnimatedStyleProp
  scale?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  const pressed = useSharedValue(1)
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: pressed.value }] }))
  return (
    <AnimatedPressable
      {...props}
      className={className}
      onPressIn={(e) => {
        if (!reduced) pressed.set(withSpring(scale, spring.snappy))
        props.onPressIn?.(e)
      }}
      onPressOut={(e) => {
        pressed.set(withSpring(1, spring.snappy))
        props.onPressOut?.(e)
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  )
}
