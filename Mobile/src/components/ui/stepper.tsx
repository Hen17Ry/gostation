import { Minus, Plus } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { type AccessibilityActionEvent, Pressable, TextInput, View } from 'react-native'
import { useReducedMotion, useSharedValue, withSequence, withTiming, useAnimatedStyle } from 'react-native-reanimated'

import { t } from '@/i18n'
import { AnimatedView } from '@/lib/animated'
import { cn } from '@/lib/cn'
import { formatInteger } from '@/lib/format'
import { haptics } from '@/lib/haptics'
import { useTheme } from '@/theme/theme'

import { Text } from './text'

/** Appui long : premier pas après 350 ms, puis un pas toutes les 90 ms, de plus en plus grand. */
const HOLD_DELAY_MS = 350
const REPEAT_MS = 90
const stepFor = (repeats: number) => (repeats < 10 ? 1 : repeats < 25 ? 5 : 10)

/** Pas de l'appui long après `repeats` répétitions (testé à part). */
export const holdStep = stepFor

/**
 * Compteur de bouteilles (D59), pensé pour une main : − et + de 56 dp, appui long qui accélère
 * (1, puis 5, puis 10 par pas), nombre modifiable en le touchant (pavé numérique), tremblement
 * léger en butée (0 ou plafond). Lecteur d'écran : élément réglable (glisser vers le haut ou le bas).
 */
export function Stepper({
  value,
  max,
  onChange,
  label,
  valueText,
  decreaseLabel,
  increaseLabel,
  changed,
  testID,
}: {
  value: number
  max: number
  onChange: (v: number) => void
  label: string
  /** Valeur lue par le lecteur d'écran (« 12 bouteilles »). */
  valueText: string
  decreaseLabel: string
  increaseLabel: string
  /** Valeur différente de la dernière envoyée (mise en avant). */
  changed?: boolean
  testID?: string
}) {
  const { colors } = useTheme()
  const reduced = useReducedMotion()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  // Valeur vue par l'appui long (les pas s'enchaînent avant le rendu suivant).
  const current = useRef(value)
  useEffect(() => {
    current.current = value
  }, [value])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeats = useRef(0)

  const shake = useSharedValue(0)
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }))
  const bump = () => {
    haptics.warning()
    if (reduced) return
    shake.set(
      withSequence(
        withTiming(-6, { duration: 50 }),
        withTiming(6, { duration: 50 }),
        withTiming(-3, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      ),
    )
  }

  /** Applique un pas ; renvoie false en butée (l'appui long s'arrête). */
  const apply = (delta: number) => {
    const from = current.current
    const next = Math.max(0, Math.min(max, from + delta))
    if (next === from) {
      bump()
      return false
    }
    current.current = next
    onChange(next)
    return true
  }

  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stop, [])

  const hold = (sign: 1 | -1) => {
    repeats.current = 0
    haptics.selection()
    const tick = () => {
      if (!apply(sign * stepFor(repeats.current))) return stop()
      repeats.current += 1
      timer.current = setTimeout(tick, REPEAT_MS)
    }
    tick()
  }

  const commitText = () => {
    setEditing(false)
    const digits = text.replace(/\D/g, '')
    if (digits === '') return
    const n = Math.min(max, Number(digits))
    if (n !== value) onChange(n)
  }

  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') apply(1)
    else if (e.nativeEvent.actionName === 'decrement') apply(-1)
    else if (e.nativeEvent.actionName === 'activate') startEditing()
  }
  const startEditing = () => {
    setText(String(value))
    setEditing(true)
  }

  const button = (sign: 1 | -1) => {
    const disabled = sign < 0 ? value <= 0 : value >= max
    const Icon = sign < 0 ? Minus : Plus
    return (
      <Pressable
        testID={testID ? `${testID}-${sign < 0 ? 'minus' : 'plus'}` : undefined}
        accessibilityLabel={sign < 0 ? decreaseLabel : increaseLabel}
        onPress={() => apply(sign)}
        onLongPress={() => hold(sign)}
        delayLongPress={HOLD_DELAY_MS}
        onPressOut={stop}
        android_ripple={{ color: colors.accent, borderless: true, radius: 30 }}
        className={cn(
          'h-14 w-14 items-center justify-center rounded-full border',
          disabled ? 'border-border bg-surface' : 'border-border-strong bg-surface',
        )}
      >
        <Icon size={24} color={disabled ? colors['muted-foreground'] : colors.foreground} strokeWidth={2.4} />
      </Pressable>
    )
  }

  return (
    <AnimatedView
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint={t.manager.stocks.editQuantity}
      accessibilityValue={{ min: 0, max, now: value, text: valueText }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
      onAccessibilityAction={onAction}
      className="flex-row items-center gap-2"
      style={shakeStyle}
    >
      {button(-1)}
      <Pressable
        testID={testID ? `${testID}-value` : undefined}
        onPress={startEditing}
        className={cn(
          'h-14 min-w-[84px] flex-1 items-center justify-center rounded-lg border-2 px-2',
          changed ? 'border-primary bg-primary-subtle' : 'border-transparent bg-secondary',
        )}
      >
        {editing ? (
          <TextInput
            testID={testID ? `${testID}-input` : undefined}
            autoFocus
            value={text}
            onChangeText={setText}
            onBlur={commitText}
            onSubmitEditing={commitText}
            keyboardType="number-pad"
            returnKeyType="done"
            selectTextOnFocus
            maxLength={String(max).length}
            className="h-14 w-full text-center"
            style={{ color: colors.foreground, fontFamily: 'GeistMono_500Medium', fontSize: 24 }}
          />
        ) : (
          <View className="flex-row items-baseline">
            <Text variant="title2" mono weight="semibold" tone={changed ? 'onPrimarySubtle' : 'default'}>
              {formatInteger(value)}
            </Text>
          </View>
        )}
      </Pressable>
      {button(1)}
    </AnimatedView>
  )
}
