import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { useTheme } from '@/theme/theme'

const RINGS = 3
const PERIOD = 1800

/**
 * Animation de recherche : des ondes partent du point de recherche et s'élargissent, comme le
 * rayon qui s'agrandit côté API (500 m, 1, 2, 5 km…). Transform et opacité sur le thread UI ;
 * pulsation simple si l'utilisateur réduit les animations. Décorative (l'état est annoncé par le
 * bouton « Recherche des stations… »).
 */
export function SearchPulse({ x, y, radius }: { x: number; y: number; radius: number }) {
  const reduced = useReducedMotion()
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill]}
    >
      {Array.from({ length: reduced ? 1 : RINGS }, (_, i) => (
        <Ring key={i} index={i} x={x} y={y} radius={radius} reduced={reduced} />
      ))}
      <Dot x={x} y={y} />
    </View>
  )
}

function Ring({
  index,
  x,
  y,
  radius,
  reduced,
}: {
  index: number
  x: number
  y: number
  radius: number
  reduced: boolean
}) {
  const { colors } = useTheme()
  const p = useSharedValue(0)
  useEffect(() => {
    p.value = reduced
      ? withRepeat(withTiming(1, { duration: 900 }), -1, true)
      : withDelay(
          (index * PERIOD) / RINGS,
          withRepeat(withTiming(1, { duration: PERIOD, easing: Easing.out(Easing.cubic) }), -1, false),
        )
    return () => cancelAnimation(p)
  }, [p, index, reduced])
  const style = useAnimatedStyle(() =>
    reduced
      ? { opacity: 0.15 + 0.2 * p.value, transform: [{ scale: 0.6 }] }
      : { opacity: 0.55 * (1 - p.value), transform: [{ scale: 0.08 + 0.92 * p.value }] },
  )
  const size = radius * 2
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: x - radius,
          top: y - radius,
          width: size,
          height: size,
          borderRadius: radius,
          borderWidth: 2,
          borderColor: colors.primary,
          backgroundColor: `${colors.primary}22`,
        },
        style,
      ]}
    />
  )
}

function Dot({ x, y }: { x: number; y: number }) {
  const { colors } = useTheme()
  return (
    <View
      style={{
        position: 'absolute',
        left: x - 9,
        top: y - 9,
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: colors.primary,
        borderWidth: 3,
        borderColor: colors.surface,
      }}
    />
  )
}
