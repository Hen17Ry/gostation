import { zodResolver } from '@/lib/zod-resolver'
import { useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { LogIn } from 'lucide-react-native'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { View } from 'react-native'
import * as z from 'zod/mini'

import { login } from '@/api/account'
import { meKeys } from '@/api/keys'
import { FormField } from '@/components/form/form-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { applyApiErrors } from '@/lib/form-errors'
import { haptics } from '@/lib/haptics'
import { useCloseFlow } from '@/lib/navigation'
import { emailField, passwordField } from '@/lib/validation'

const schema = z.object({ email: emailField, password: passwordField })
type Values = z.infer<typeof schema>

/** Connexion (réponse générique en cas d'échec : anti-énumération côté API). */
export default function SignIn() {
  const closeFlow = useCloseFlow()
  const { reason } = useLocalSearchParams<{ reason?: string }>()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })

  const submit = form.handleSubmit(async (v) => {
    setError(null)
    try {
      const me = await login(v.email, v.password)
      qc.setQueryData(meKeys.profile(), me)
      haptics.success()
      if (!me.emailVerified) {
        router.replace({ pathname: '/auth/verify', params: { email: me.email } })
        return
      }
      toast.success(t.auth.welcome(me.firstName))
      closeFlow()
    } catch (e) {
      haptics.error()
      setError(applyApiErrors(e, form.setError, ['email', 'password']))
    }
  })

  return (
    <Screen
      title={t.auth.signInTitle}
      subtitle={reason === 'required' ? t.auth.requiredBody : undefined}
      footer={
        <Button
          testID="sign-in-submit"
          label={t.auth.signIn}
          icon={LogIn}
          size="lg"
          loading={form.formState.isSubmitting}
          onPress={submit}
        />
      }
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <FormField
        testID="sign-in-email"
        control={form.control}
        name="email"
        label={t.auth.email}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        autoCapitalize="none"
        returnKeyType="next"
      />
      <FormField
        testID="sign-in-password"
        control={form.control}
        name="password"
        label={t.auth.password}
        secure
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <View className="items-start gap-1">
        <Button label={t.auth.forgot} variant="link" size="sm" onPress={() => router.push('/auth/forgot')} />
        <Button
          testID="go-sign-up"
          label={t.auth.noAccount}
          variant="link"
          size="sm"
          onPress={() => router.replace('/auth/sign-up')}
        />
      </View>
    </Screen>
  )
}
