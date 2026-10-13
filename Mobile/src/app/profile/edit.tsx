import { zodResolver } from '@/lib/zod-resolver'
import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import * as z from 'zod/mini'

import { updateProfile } from '@/api/account'
import { meKeys } from '@/api/keys'
import { FormField } from '@/components/form/form-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { toast } from '@/components/ui/toast'
import { useMe } from '@/features/auth/use-me'
import { t } from '@/i18n'
import { applyApiErrors } from '@/lib/form-errors'
import { nameField } from '@/lib/validation'

const schema = z.object({ firstName: nameField, lastName: nameField })

export default function EditProfile() {
  const { me } = useMe()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    values: { firstName: me?.firstName ?? '', lastName: me?.lastName ?? '' },
  })
  const submit = form.handleSubmit(async (v) => {
    setError(null)
    try {
      qc.setQueryData(meKeys.profile(), await updateProfile(v))
      toast.success(t.common.saved)
      router.back()
    } catch (e) {
      setError(applyApiErrors(e, form.setError, ['firstName', 'lastName']))
    }
  })
  return (
    <Screen
      title={t.account.editProfile}
      footer={<Button label={t.common.save} size="lg" loading={form.formState.isSubmitting} onPress={submit} />}
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <FormField control={form.control} name="firstName" label={t.auth.firstName} autoComplete="given-name" />
      <FormField control={form.control} name="lastName" label={t.auth.lastName} autoComplete="family-name" />
    </Screen>
  )
}
