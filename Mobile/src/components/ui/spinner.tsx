import { useEffect } from 'react'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

/**
 * Indicateur d'activité : anneau ouvert qui tourne (transform sur le thread UI, une seule vue).
 * Remplace l'`ActivityIndicator` natif, dont la création prenait 30 à 46 ms au thread principal
 * sur le S10, à l'instant même de l'appui (« Rechercher »). Décoratif : l'état occupé est annoncé
 * par le composant qui l'affiche. Anneau fixe si l'utilisateur réduit les animations.
 */
export function Spinner({ color, size = 20 }: { color: string; size?: number }) {
  const reduced = useReducedMotion()
  const turn = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    turn.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.linear }), -1, false)
    return () => cancelAnimation(turn)
  }, [turn, reduced])
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }))
  const ring = Math.max(2, Math.round(size / 9))
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ring,
          borderColor: color,
          borderTopColor: 'transparent',
        },
        style,
      ]}
    />
  )
}
