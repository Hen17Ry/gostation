import { useRef, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'

import { cn } from '@/lib/cn'
import { useTheme } from '@/theme/theme'

import { Text } from './text'

const LENGTH = 6

/**
 * Code à 6 chiffres : un seul champ natif invisible (saisie automatique `one-time-code` /
 * `sms-otp`, collage d'un code entier, gestionnaires) sous six cases visuelles. `onComplete` part
 * dès le 6ᵉ chiffre.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  label,
  error,
  autoFocus = true,
}: {
  value: string
  onChange: (code: string) => void
  onComplete?: (code: string) => void
  label: string
  error?: string
  autoFocus?: boolean
}) {
  const { colors } = useTheme()
  const ref = useRef<TextInput>(null)
  const [focused, setFocused] = useState(false)
  return (
    <View className="gap-2">
      <Pressable accessible={false} onPress={() => ref.current?.focus()} className="flex-row justify-between gap-2">
        {Array.from({ length: LENGTH }, (_, i) => {
          const active = focused && (i === value.length || (i === LENGTH - 1 && value.length === LENGTH))
          return (
            <View
              key={i}
              className={cn(
                'h-14 flex-1 items-center justify-center rounded-lg border bg-surface',
                error ? 'border-destructive' : active ? 'border-ring' : 'border-input',
              )}
              style={active && !error ? { borderWidth: 2 } : undefined}
            >
              <Text variant="title2" weight="semibold" className="font-geist-mono">
                {value[i] ?? ''}
              </Text>
            </View>
          )
        })}
      </Pressable>
      <TextInput
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        accessibilityLabel={label}
        accessibilityHint={error}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={LENGTH}
        caretHidden
        selectionColor={colors.primary}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={(text) => {
          const code = text.replace(/\D/g, '').slice(0, LENGTH)
          onChange(code)
          if (code.length === LENGTH) {
            // Code complet : on referme le clavier avant l'envoi (il ne doit pas survivre à l'écran).
            ref.current?.blur()
            onComplete?.(code)
          }
        }}
        // Invisible mais focalisable et lu par les lecteurs d'écran.
        style={{ position: 'absolute', opacity: 0.011, height: 1, width: 1 }}
      />
      {error && (
        <Text variant="footnote" tone="destructive" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  )
}
