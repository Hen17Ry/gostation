import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { useWindowDimensions, View } from 'react-native'
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { FindArt, NoAccountArt, PrivacyArt } from '@/components/brand/onboarding-art'
import { LogoMark } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useLocation } from '@/features/location/location-store'
import { t } from '@/i18n'
import { AnimatedView } from '@/lib/animated'
import { haptics } from '@/lib/haptics'
import { usePrefs } from '@/stores/prefs'

const ART = [FindArt, PrivacyArt, NoAccountArt]
const COUNT = t.onboarding.slides.length

/**
 * Premier lancement : ce que fait l'app, pourquoi la localisation (expliquée AVANT la demande
 * système), usage sans compte. Défilement horizontal au doigt ou par les boutons.
 */
export default function Onboarding() {
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const scroll = useRef<Animated.ScrollView>(null)
  const x = useSharedValue(0)
  const [page, setPage] = useState(0)
  const [asking, setAsking] = useState(false)
  const requestPermission = useLocation((s) => s.requestPermission)
  const setOnboarded = usePrefs((s) => s.setOnboarded)

  const onScroll = useAnimatedScrollHandler((e) => {
    x.value = e.contentOffset.x
  })

  const goTo = (i: number) => {
    scroll.current?.scrollTo({ x: i * width, animated: true })
    setPage(i)
  }

  const finish = (next?: '/auth/sign-up') => {
    haptics.success()
    setOnboarded()
    router.replace('/')
    if (next) setTimeout(() => router.push(next), 0)
  }

  const allowLocation = async () => {
    setAsking(true)
    try {
      await requestPermission()
    } finally {
      setAsking(false)
      goTo(2)
    }
  }

  const art = Math.min(260, width - 80)

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }}
    >
      <View className="h-14 flex-row items-center justify-between px-5">
        <View className="flex-row items-center gap-2">
          <LogoMark size={28} />
          <Text variant="headline" weight="bold">
            {t.app.name}
          </Text>
        </View>
        {page < COUNT - 1 && (
          <Button label={t.onboarding.skip} variant="ghost" size="sm" onPress={() => goTo(COUNT - 1)} />
        )}
      </View>

      <Animated.ScrollView
        ref={scroll}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={{ flex: 1 }}
      >
        {t.onboarding.slides.map((slide, i) => {
          const Art = ART[i]!
          return (
            <View key={slide.title} style={{ width }} className="flex-1 items-center justify-center gap-8 px-8">
              <Parallax x={x} index={i} width={width}>
                <Art size={art} />
              </Parallax>
              <View
                className="gap-3"
                accessible
                accessibilityLabel={`${t.onboarding.step(i + 1, COUNT)}. ${slide.title}. ${slide.body}`}
              >
                <Text variant="title1" className="text-center" accessibilityRole="header">
                  {slide.title}
                </Text>
                <Text variant="body" tone="muted" className="text-center">
                  {slide.body}
                </Text>
              </View>
            </View>
          )
        })}
      </Animated.ScrollView>

      <View className="gap-5 px-6 pt-2">
        <Dots x={x} width={width} />
        {page === 0 && <Button label={t.common.next} size="lg" onPress={() => goTo(1)} testID="onboarding-next" />}
        {page === 1 && (
          <View className="gap-2">
            <Button
              label={t.onboarding.allowLocation}
              size="lg"
              loading={asking}
              onPress={allowLocation}
              testID="onboarding-allow-location"
            />
            <Button label={t.onboarding.notNow} variant="ghost" onPress={() => goTo(2)} testID="onboarding-later" />
          </View>
        )}
        {page === 2 && (
          <View className="gap-2">
            <Button label={t.onboarding.start} size="lg" onPress={() => finish()} testID="onboarding-start" />
            <Button
              label={t.onboarding.createAccount}
              variant="ghost"
              onPress={() => finish('/auth/sign-up')}
              testID="onboarding-sign-up"
            />
          </View>
        )}
      </View>
    </View>
  )
}

/** Léger décalage de l'illustration pendant le défilement (profondeur). */
function Parallax({
  x,
  index,
  width,
  children,
}: {
  x: SharedValue<number>
  index: number
  width: number
  children: React.ReactNode
}) {
  const style = useAnimatedStyle(() => {
    const p = x.value / width - index
    return {
      opacity: interpolate(p, [-1, 0, 1], [0, 1, 0]),
      transform: [
        { translateX: interpolate(p, [-1, 0, 1], [width * 0.25, 0, -width * 0.25]) },
        { scale: interpolate(p, [-1, 0, 1], [0.9, 1, 0.9]) },
      ],
    }
  })
  return <Animated.View style={style}>{children}</Animated.View>
}

function Dots({ x, width }: { x: SharedValue<number>; width: number }) {
  return (
    <View
      className="flex-row justify-center gap-2.5"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: COUNT }, (_, i) => (
        <Dot key={i} x={x} index={i} width={width} />
      ))}
    </View>
  )
}

function Dot({ x, index, width }: { x: SharedValue<number>; index: number; width: number }) {
  const style = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(x.value / width - index))
    // Transform et opacité seulement (pas d'animation de largeur : thread UI, sans relayout).
    return { opacity: interpolate(d, [0, 1], [1, 0.3]), transform: [{ scale: interpolate(d, [0, 1], [1.35, 1]) }] }
  })
  return <AnimatedView className="h-2 w-2 rounded-full bg-primary" style={style} />
}
