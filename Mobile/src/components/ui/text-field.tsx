import { Eye, EyeOff } from 'lucide-react-native'
import { forwardRef, useId, useState } from 'react'
import { Pressable, TextInput, type TextInputProps, View } from 'react-native'

import { t } from '@/i18n'
import { cn } from '@/lib/cn'
import { useTheme } from '@/theme/theme'

import { Text } from './text'

/**
 * Champ de formulaire : libellé visible (jamais le seul placeholder), aide et erreur sous le
 * champ (erreur annoncée), contour ≥ 3:1, 52 dp de haut. `secure` ajoute le bouton
 * afficher/masquer. Compatible gestionnaires de mots de passe (autoComplete) et collage.
 */
export const TextField = forwardRef<
  TextInput,
  TextInputProps & { label: string; hint?: string; error?: string; secure?: boolean; className?: string }
>(function TextField({ label, hint, error, secure = false, className, ...props }, ref) {
  const { colors } = useTheme()
  const id = useId()
  const [focused, setFocused] = useState(false)
  const [visible, setVisible] = useState(false)
  return (
    <View className={cn('gap-1.5', className)}>
      <Text variant="subhead" weight="medium" nativeID={`${id}-label`}>
        {label}
      </Text>
      <View
        className={cn(
          'h-[52px] flex-row items-center rounded-lg border bg-surface px-3.5',
          error ? 'border-destructive' : focused ? 'border-ring' : 'border-input',
        )}
        style={focused && !error ? { borderWidth: 2 } : undefined}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityLabelledBy={`${id}-label`}
          accessibilityHint={error ?? hint}
          aria-invalid={!!error}
          placeholderTextColor={colors['muted-foreground']}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          secureTextEntry={secure && !visible}
          maxFontSizeMultiplier={1.6}
          className="h-full flex-1 font-geist text-body text-foreground"
          {...props}
          onFocus={(e) => {
            setFocused(true)
            props.onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            props.onBlur?.(e)
          }}
        />
        {secure && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? t.auth.hidePassword : t.auth.showPassword}
            hitSlop={12}
            onPress={() => setVisible((v) => !v)}
            className="h-12 w-12 items-center justify-center"
          >
            {visible ? (
              <EyeOff size={20} color={colors['muted-foreground']} />
            ) : (
              <Eye size={20} color={colors['muted-foreground']} />
            )}
          </Pressable>
        )}
      </View>
      {error ? (
        <Text variant="footnote" tone="destructive" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : (
        hint && (
          <Text variant="footnote" tone="muted">
            {hint}
          </Text>
        )
      )}
    </View>
  )
})
