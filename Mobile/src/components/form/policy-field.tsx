import { router } from 'expo-router'
import { Check } from 'lucide-react-native'
import { type Control, Controller, type FieldPath, type FieldValues } from 'react-hook-form'
import { Pressable, View } from 'react-native'

import { PRIVACY_POLICY_VERSION } from '@/api/account'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'
import { cn } from '@/lib/cn'
import { haptics } from '@/lib/haptics'
import { useTheme } from '@/theme/theme'

/**
 * Acceptation des conditions d'utilisation et de la politique de confidentialité (version livrée
 * avec l'app), avec les liens vers leurs textes.
 */
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
            accessibilityLabel={t.auth.acceptPolicy(PRIVACY_POLICY_VERSION)}
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
              {t.auth.acceptPolicy(PRIVACY_POLICY_VERSION)}
            </Text>
          </Pressable>
          {fieldState.error && (
            <Text variant="footnote" tone="destructive" accessibilityRole="alert">
              {fieldState.error.message}
            </Text>
          )}
          <View className="flex-row flex-wrap gap-x-4">
            <Button
              testID="read-terms"
              label={t.auth.readTerms}
              variant="link"
              size="sm"
              onPress={() => router.push('/legal/terms')}
            />
            <Button
              testID="read-policy"
              label={t.auth.readPolicy}
              variant="link"
              size="sm"
              onPress={() => router.push('/legal/privacy')}
            />
          </View>
        </View>
      )}
    />
  )
}
