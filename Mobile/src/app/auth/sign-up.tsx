import { zodResolver } from '@/lib/zod-resolver'
import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Check, UserPlus } from 'lucide-react-native'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Pressable, View } from 'react-native'
import * as z from 'zod/mini'

import { register } from '@/api/account'
import { meKeys } from '@/api/keys'
import { FormField } from '@/components/form/form-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'
import { cn } from '@/lib/cn'
import { applyApiErrors } from '@/lib/form-errors'
import { haptics } from '@/lib/haptics'
import { emailField, nameField, newPasswordField } from '@/lib/validation'
import { useTheme } from '@/theme/theme'

const schema = z.object({
  firstName: nameField,
  lastName: nameField,
  email: emailField,
  password: newPasswordField,
  policy: z.boolean().check(z.refine((v) => v, { error: t.validation.policy })),
})
type Values = z.infer<typeof schema>

/** Inscription : prénom, nom, email, mot de passe, acceptation de la politique v1.0 ; puis code. */
export default function SignUp() {
  const qc = useQueryClient()
  const { colors } = useTheme()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '', policy: false },
  })

  const submit = form.handleSubmit(async ({ policy: _policy, ...v }) => {
    setError(null)
    try {
      const me = await register(v)
      qc.setQueryData(meKeys.profile(), me)
      haptics.success()
      router.replace({ pathname: '/auth/verify', params: { email: me.email } })
    } catch (e) {
      haptics.error()
      setError(applyApiErrors(e, form.setError, ['firstName', 'lastName', 'email', 'password']))
    }
  })

  return (
    <Screen
      title={t.auth.signUpTitle}
      subtitle={t.auth.signUpSubtitle}
      footer={
        <Button
          testID="sign-up-submit"
          label={t.auth.signUp}
          icon={UserPlus}
          size="lg"
          loading={form.formState.isSubmitting}
          onPress={submit}
        />
      }
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <View className="flex-row gap-3">
        <FormField
          testID="sign-up-first-name"
          control={form.control}
          name="firstName"
          label={t.auth.firstName}
          autoComplete="given-name"
          textContentType="givenName"
          className="flex-1"
        />
        <FormField
          testID="sign-up-last-name"
          control={form.control}
          name="lastName"
          label={t.auth.lastName}
          autoComplete="family-name"
          textContentType="familyName"
          className="flex-1"
        />
      </View>
      <FormField
        testID="sign-up-email"
        control={form.control}
        name="email"
        label={t.auth.email}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <FormField
        testID="sign-up-password"
        control={form.control}
        name="password"
        label={t.auth.password}
        hint={t.auth.passwordHint}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Controller
        control={form.control}
        name="policy"
        render={({ field, fieldState }) => (
          <View className="gap-1.5">
            <Pressable
              testID="sign-up-policy"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: field.value }}
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
              <Button
                label={t.auth.readPolicy}
                variant="link"
                size="sm"
                onPress={() => router.push('/legal/privacy')}
              />
            </View>
          </View>
        )}
      />
      <Button
        label={t.auth.haveAccount}
        variant="link"
        size="sm"
        className="self-start"
        onPress={() => router.replace('/auth/sign-in')}
      />
    </Screen>
  )
}
