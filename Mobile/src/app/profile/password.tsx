import { zodResolver } from '@/lib/zod-resolver'
import { router } from 'expo-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import * as z from 'zod/mini'

import { changePassword } from '@/api/account'
import { FormField } from '@/components/form/form-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { applyApiErrors } from '@/lib/form-errors'
import { haptics } from '@/lib/haptics'
import { newPasswordField, passwordField } from '@/lib/validation'

const schema = z.object({ currentPassword: passwordField, newPassword: newPasswordField })

export default function ChangePassword() {
  const [error, setError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '' },
  })
  const submit = form.handleSubmit(async (v) => {
    setError(null)
    try {
      await changePassword(v.currentPassword, v.newPassword)
      haptics.success()
      toast.success(t.account.passwordChanged)
      router.back()
    } catch (e) {
      haptics.error()
      setError(applyApiErrors(e, form.setError, ['currentPassword', 'newPassword']))
    }
  })
  return (
    <Screen
      title={t.account.password}
      footer={
        <Button
          testID="password-submit"
          label={t.common.save}
          size="lg"
          loading={form.formState.isSubmitting}
          onPress={submit}
        />
      }
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <FormField
        control={form.control}
        name="currentPassword"
        testID="current-password"
        label={t.account.currentPassword}
        secure
        autoComplete="current-password"
        textContentType="password"
      />
      <FormField
        control={form.control}
        name="newPassword"
        testID="new-password"
        label={t.auth.newPassword}
        hint={t.auth.passwordHint}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
      />
    </Screen>
  )
}
