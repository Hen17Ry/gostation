import { zodResolver } from '@/lib/zod-resolver'
import { Trash2 } from 'lucide-react-native'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import * as z from 'zod/mini'

import { deleteAccount } from '@/api/account'
import { FormField } from '@/components/form/form-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { applyApiErrors } from '@/lib/form-errors'
import { haptics } from '@/lib/haptics'
import { useCloseFlow } from '@/lib/navigation'
import { passwordField } from '@/lib/validation'

const schema = z.object({ password: passwordField })

/** Suppression du compte : désactivation immédiate, purge sous 30 jours (DELETE /me). */
export default function DeleteAccount() {
  const closeFlow = useCloseFlow()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '' } })
  const submit = form.handleSubmit(async (v) => {
    setError(null)
    try {
      await deleteAccount(v.password)
      haptics.warning()
      toast.info(t.account.deleted)
      closeFlow()
    } catch (e) {
      haptics.error()
      setError(applyApiErrors(e, form.setError, ['password']))
    }
  })
  return (
    <Screen
      title={t.account.deleteTitle}
      footer={
        <Button
          testID="delete-submit"
          label={t.account.delete}
          icon={Trash2}
          variant="destructive"
          size="lg"
          loading={form.formState.isSubmitting}
          onPress={submit}
        />
      }
    >
      <Banner tone="danger">{t.account.deleteBody}</Banner>
      {error && <Banner tone="danger">{error}</Banner>}
      <FormField
        control={form.control}
        name="password"
        testID="delete-password"
        label={t.auth.password}
        secure
        autoComplete="current-password"
        textContentType="password"
      />
    </Screen>
  )
}
