import { cssInterop } from 'nativewind'
import { type ComponentProps } from 'react'
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'
import Animated from 'react-native-reanimated'

/**
 * Composants Reanimated qui acceptent `className`. NativeWind (css-interop) ne doit jamais toucher au
 * style animé : il l'aplatirait en objet ordinaire (lecture des valeurs pendant le rendu, classes et
 * animation perdues). Ici, css-interop résout seulement `className` vers `classStyle`, puis le
 * composant passe `[classStyle, style]` à Reanimated, intact.
 */
type WithClass<P> = P & { className?: string; classStyle?: StyleProp<ViewStyle> }

const RawAnimatedPressable = Animated.createAnimatedComponent(Pressable)

function AnimatedViewBase({ classStyle, style, ...props }: WithClass<ComponentProps<typeof Animated.View>>) {
  return <Animated.View {...props} style={[classStyle, style]} />
}

/** Style accepté par un composant animé (styles ordinaires et `useAnimatedStyle`). */
export type AnimatedStyleProp = ComponentProps<typeof Animated.View>['style']

function AnimatedPressableBase({
  classStyle,
  style,
  ...props
}: WithClass<Omit<PressableProps, 'style'>> & { style?: AnimatedStyleProp }) {
  return <RawAnimatedPressable {...props} style={[classStyle, style]} />
}

cssInterop(AnimatedViewBase, { className: { target: 'classStyle' } })
cssInterop(AnimatedPressableBase, { className: { target: 'classStyle' } })

export const AnimatedView = AnimatedViewBase
export const AnimatedPressable = AnimatedPressableBase
