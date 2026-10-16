import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Send } from 'lucide-react-native'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { View } from 'react-native'

import { createDataRequest } from '@/api/account'
import { meKeys } from '@/api/keys'
import { FormField } from '@/components/form/form-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { RadioCard } from '@/components/ui/radio-card'
import { Screen } from '@/components/ui/screen'
import { Text } from '@/components/ui/text'
import { toast } from '@/components/ui/toast'
import { DETAILS_REQUIRED, REQUEST_TYPES, requestSchema, type RequestValues } from '@/features/privacy/request-form'
import { t } from '@/i18n'
import { applyApiErrors } from '@/lib/form-errors'
import { haptics } from '@/lib/haptics'
import { zodResolver } from '@/lib/zod-resolver'

/** Faire une demande (droits des personnes) : type, précisions ; accusé de réception par email. */
export default function DataRequestScreen() {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { type: 'access', details: '' },
  })
  const type = useWatch({ control: form.control, name: 'type' })
  const submit = form.handleSubmit(async (v) => {
    setError(null)
    try {
      await createDataRequest(v.type, v.details.trim() || undefined)
      void qc.invalidateQueries({ queryKey: meKeys.dataRequests() })
      haptics.success()
      toast.success(t.privacy.sent)
      router.back()
    } catch (e) {
      haptics.error()
      setError(applyApiErrors(e, form.setError, ['type', 'details']))
    }
  })
  return (
    <Screen
      title={t.privacy.requestTitle}
      subtitle={t.privacy.requestIntro}
      footer={
        <Button
          testID="data-request-submit"
          label={t.privacy.send}
          icon={Send}
          size="lg"
          loading={form.formState.isSubmitting}
          onPress={submit}
        />
      }
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <Text variant="subhead" weight="medium" accessibilityRole="header">
        {t.privacy.type}
      </Text>
      <Controller
        control={form.control}
        name="type"
        render={({ field }) => (
          <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={t.privacy.type}>
            {REQUEST_TYPES.map((k) => (
              <RadioCard
                key={k}
                testID={`data-request-type-${k}`}
                label={t.privacy.types[k]!}
                hint={t.privacy.typeHints[k]}
                selected={field.value === k}
                onPress={() => field.onChange(k)}
              />
            ))}
          </View>
        )}
      />
      {type === 'deletion' && <Banner tone="info">{t.privacy.deletionTip}</Banner>}
      {type === 'access' && <Banner tone="info">{t.privacy.accessTip}</Banner>}
      <FormField
        control={form.control}
        name="details"
        testID="data-request-details"
        label={t.privacy.details}
        hint={DETAILS_REQUIRED.includes(type) ? t.privacy.detailsNeeded : t.privacy.detailsOptional}
        multiline
        numberOfLines={4}
        maxLength={2000}
        textAlignVertical="top"
      />
    </Screen>
  )
}
