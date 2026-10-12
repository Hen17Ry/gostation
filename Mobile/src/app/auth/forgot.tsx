import { zodResolver } from '@/lib/zod-resolver'
import { router } from 'expo-router'
import { Send } from 'lucide-react-native'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import * as z from 'zod/mini'

import { forgotPassword } from '@/api/account'
import { isApiError } from '@/api/errors'
import { FormField } from '@/components/form/form-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { t } from '@/i18n'
import { emailField } from '@/lib/validation'

const schema = z.object({ email: emailField })

/** Mot de passe oublié : réponse identique que le compte existe ou non (anti-énumération). */
export default function Forgot() {
  const [error, setError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: '' } })
  const submit = form.handleSubmit(async ({ email }) => {
    setError(null)
    try {
      await forgotPassword(email)
      router.replace({ pathname: '/auth/reset', params: { email } })
    } catch (e) {
      setError(isApiError(e) ? e.userMessage : t.common.errorTitle)
    }
  })
  return (
    <Screen
      title={t.auth.forgotTitle}
      subtitle={t.auth.forgotSubtitle}
      footer={
        <Button label={t.auth.sendCode} icon={Send} size="lg" loading={form.formState.isSubmitting} onPress={submit} />
      }
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <FormField
        control={form.control}
        name="email"
        label={t.auth.email}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        autoCapitalize="none"
        returnKeyType="send"
        onSubmitEditing={submit}
      />
    </Screen>
  )
}
