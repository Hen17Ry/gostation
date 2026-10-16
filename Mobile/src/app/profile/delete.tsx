import { zodResolver } from '@/lib/zod-resolver'
import { Trash2 } from 'lucide-react-native'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { View } from 'react-native'
import * as z from 'zod/mini'

import { deleteAccount } from '@/api/account'
import { FormField } from '@/components/form/form-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Screen } from '@/components/ui/screen'
import { Text } from '@/components/ui/text'
import { toast } from '@/components/ui/toast'
import { useMe } from '@/features/auth/use-me'
import { t } from '@/i18n'
import { applyApiErrors } from '@/lib/form-errors'
import { haptics } from '@/lib/haptics'
import { useCloseFlow } from '@/lib/navigation'
import { passwordField } from '@/lib/validation'

const schema = z.object({ password: passwordField })

/**
 * Suppression du compte (DELETE /me) : ce qui est supprimé tout de suite, ce qui est conservé et
 * pourquoi (variante gérant), puis confirmation par le mot de passe. Anonymisation immédiate.
 */
export default function DeleteAccount() {
  const closeFlow = useCloseFlow()
  const { me } = useMe()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '' } })
  const submit = form.handleSubmit(async (v) => {
    setError(null)
    try {
      await deleteAccount(v.password)
      haptics.warning()
      toast.info(t.privacy.deleted)
      closeFlow()
    } catch (e) {
      haptics.error()
      setError(applyApiErrors(e, form.setError, ['password']))
    }
  })
  return (
    <Screen
      title={t.privacy.deleteTitle}
      footer={
        <Button
          testID="delete-submit"
          label={t.privacy.deleteSubmit}
          icon={Trash2}
          variant="destructive"
          size="lg"
          loading={form.formState.isSubmitting}
          onPress={submit}
        />
      }
    >
      <Banner tone="danger">{t.privacy.deleteIntro}</Banner>
      <Facts title={t.privacy.deletedNow} items={t.privacy.deletedList} />
      <Facts title={t.privacy.keptTitle} items={t.privacy.keptList} />
      {me?.role === 'manager' && (
        <Facts title={t.privacy.managerTitle} items={t.privacy.managerList} testID="delete-manager" />
      )}
      {error && <Banner tone="danger">{error}</Banner>}
      <FormField
        control={form.control}
        name="password"
        testID="delete-password"
        label={t.auth.password}
        hint={t.privacy.confirmHint}
        secure
        autoComplete="current-password"
        textContentType="password"
      />
    </Screen>
  )
}

function Facts({ title, items, testID }: { title: string; items: readonly string[]; testID?: string }) {
  return (
    <Card className="gap-2" testID={testID}>
      <Text variant="headline" accessibilityRole="header">
        {title}
      </Text>
      <View className="gap-1.5" accessibilityRole="list">
        {items.map((it) => (
          <View key={it} className="flex-row gap-2.5 pr-1">
            <Text variant="subhead" tone="muted" accessibilityElementsHidden importantForAccessibility="no">
              •
            </Text>
            <Text variant="subhead" className="flex-1">
              {it}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  )
}
