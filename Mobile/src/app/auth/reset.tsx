import { zodResolver } from '@/lib/zod-resolver'
import { router, useLocalSearchParams } from 'expo-router'
import { KeyRound } from 'lucide-react-native'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import * as z from 'zod/mini'

import { resetPassword } from '@/api/account'
import { FormField } from '@/components/form/form-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { OtpInput } from '@/components/ui/otp-input'
import { Screen } from '@/components/ui/screen'
import { Text } from '@/components/ui/text'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { applyApiErrors } from '@/lib/form-errors'
import { haptics } from '@/lib/haptics'
import { codeField, newPasswordField } from '@/lib/validation'

const schema = z.object({ code: codeField, newPassword: newPasswordField })

/** Code reçu + nouveau mot de passe ; toutes les sessions sont fermées côté API. */
export default function Reset() {
  const { email = '' } = useLocalSearchParams<{ email?: string }>()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', newPassword: '' },
  })
  const submit = form.handleSubmit(async (v) => {
    setError(null)
    try {
      await resetPassword(email, v.code, v.newPassword)
      haptics.success()
      toast.success(t.auth.resetDone)
      router.replace('/auth/sign-in')
    } catch (e) {
      haptics.error()
      setError(applyApiErrors(e, form.setError, ['code', 'newPassword']))
    }
  })
  return (
    <Screen
      title={t.auth.resetTitle}
      subtitle={t.auth.resetSubtitle(email)}
      footer={
        <Button
          testID="reset-submit"
          label={t.auth.reset}
          icon={KeyRound}
          size="lg"
          loading={form.formState.isSubmitting}
          onPress={submit}
        />
      }
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <Text variant="subhead" weight="medium">
        {t.auth.code}
      </Text>
      <Controller
        control={form.control}
        name="code"
        render={({ field, fieldState }) => (
          <OtpInput
            label={t.auth.code}
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <FormField
        control={form.control}
        name="newPassword"
        testID="reset-password"
        label={t.auth.newPassword}
        hint={t.auth.passwordHint}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
      />
    </Screen>
  )
}
