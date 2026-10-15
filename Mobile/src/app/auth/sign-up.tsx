import { zodResolver } from '@/lib/zod-resolver'
import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { UserPlus } from 'lucide-react-native'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { View } from 'react-native'
import * as z from 'zod/mini'

import { register } from '@/api/account'
import { meKeys } from '@/api/keys'
import { FormField } from '@/components/form/form-field'
import { PolicyField } from '@/components/form/policy-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { t } from '@/i18n'
import { applyApiErrors } from '@/lib/form-errors'
import { haptics } from '@/lib/haptics'
import { emailField, nameField, newPasswordField } from '@/lib/validation'

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
      <PolicyField testID="sign-up-policy" control={form.control} name="policy" />
      <Button
        label={t.auth.haveAccount}
        variant="link"
        size="sm"
        className="self-start"
        onPress={() => router.replace('/auth/sign-in')}
      />
      <Button
        testID="sign-up-manager-link"
        label={t.manager.signUpLink}
        variant="link"
        size="sm"
        className="self-start"
        onPress={() => router.replace('/auth/sign-up-manager')}
      />
    </Screen>
  )
}
