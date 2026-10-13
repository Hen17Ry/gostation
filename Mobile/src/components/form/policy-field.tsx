import { router } from 'expo-router'
import { Check } from 'lucide-react-native'
import { type Control, Controller, type FieldPath, type FieldValues } from 'react-hook-form'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'
import { cn } from '@/lib/cn'
import { haptics } from '@/lib/haptics'
import { useTheme } from '@/theme/theme'

/** Acceptation de la politique de confidentialité (v1.0), avec le lien vers son texte. */
export function PolicyField<T extends FieldValues>({
  control,
  name,
  testID,
}: {
  control: Control<T>
  name: FieldPath<T>
  testID?: string
}) {
  const { colors } = useTheme()
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View className="gap-1.5">
          <Pressable
            testID={testID}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!field.value }}
            accessibilityLabel={t.auth.acceptPolicy}
            onPress={() => {
              haptics.selection()
              field.onChange(!field.value)
            }}
            className="min-h-12 flex-row items-center gap-3"
          >
            <View
              className={cn(
                'h-6 w-6 items-center justify-center rounded-xs border-2',
                field.value ? 'border-primary bg-primary' : fieldState.error ? 'border-destructive' : 'border-input',
              )}
            >
              {field.value && <Check size={16} color={colors['primary-foreground']} strokeWidth={3} />}
            </View>
            <Text variant="subhead" className="flex-1">
              {t.auth.acceptPolicy}
            </Text>
          </Pressable>
          {fieldState.error && (
            <Text variant="footnote" tone="destructive" accessibilityRole="alert">
              {fieldState.error.message}
            </Text>
          )}
          <View className="flex-row">
            <Button label={t.auth.readPolicy} variant="link" size="sm" onPress={() => router.push('/legal/privacy')} />
          </View>
        </View>
      )}
    />
  )
}
