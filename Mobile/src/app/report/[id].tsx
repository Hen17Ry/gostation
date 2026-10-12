import { zodResolver } from '@/lib/zod-resolver'
import { useQuery } from '@tanstack/react-query'
import * as Location from 'expo-location'
import { router, useLocalSearchParams } from 'expo-router'
import { Send, ShieldCheck } from 'lucide-react-native'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Pressable, View } from 'react-native'
import * as z from 'zod/mini'

import { createReport, type ReportReason } from '@/api/account'
import { stationQuery } from '@/api/public'
import { FormField } from '@/components/form/form-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/choice-tile'
import { Screen } from '@/components/ui/screen'
import { Text } from '@/components/ui/text'
import { toast } from '@/components/ui/toast'
import { useLocation } from '@/features/location/location-store'
import { productLabel } from '@/features/search/product-picker'
import { t } from '@/i18n'
import { cn } from '@/lib/cn'
import { applyApiErrors } from '@/lib/form-errors'
import { haptics } from '@/lib/haptics'
import { useTheme } from '@/theme/theme'

const REASONS: ReportReason[] = ['out_of_stock', 'station_closed', 'wrong_location', 'other']
/** Motifs contrôlés sur place (2 km) : la position part dans la requête, et seulement là. */
const NEEDS_POSITION: ReportReason[] = ['out_of_stock', 'station_closed']

const schema = z
  .object({
    reason: z.enum(['out_of_stock', 'station_closed', 'wrong_location', 'other']),
    productId: z.nullable(z.number()),
    comment: z.string().check(z.maxLength(300, { error: t.validation.comment })),
  })
  .check(
    z.refine((v) => v.reason !== 'out_of_stock' || v.productId !== null, {
      error: t.validation.product,
      path: ['productId'],
    }),
    z.refine((v) => v.reason !== 'other' || v.comment.trim().length > 0, {
      error: t.validation.comment,
      path: ['comment'],
    }),
  )
type Values = z.infer<typeof schema>

/** Signaler un problème : motif, produit (rupture), commentaire ; contrôle de proximité expliqué. */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const station = useQuery(stationQuery(id))
  const { colors } = useTheme()
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { reason: 'out_of_stock', productId: null, comment: '' },
  })
  const reason = useWatch({ control: form.control, name: 'reason' })
  const needsPosition = NEEDS_POSITION.includes(reason)

  const submit = form.handleSubmit(async (v) => {
    setError(null)
    // Position du moment, lue juste avant l'envoi, jamais rangée dans un store ni un cache.
    let position: { lat: number; lng: number } | undefined
    if (needsPosition) {
      setLocating(true)
      try {
        const loc = useLocation.getState()
        const permission = loc.permission === 'granted' ? 'granted' : await loc.requestPermission()
        if (permission !== 'granted') {
          setError(t.route.needLocation)
          return
        }
        const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        position = { lat: fix.coords.latitude, lng: fix.coords.longitude }
      } catch {
        setError(t.location.unavailable)
        return
      } finally {
        setLocating(false)
      }
    }
    try {
      await createReport(id, {
        reason: v.reason,
        productId: v.reason === 'out_of_stock' ? (v.productId ?? undefined) : undefined,
        comment: v.comment.trim() || undefined,
        position,
      })
      haptics.success()
      toast.success(t.report.sent)
      router.back()
    } catch (e) {
      haptics.error()
      setError(applyApiErrors(e, form.setError, ['comment', 'productId']))
    }
  })

  const stocks = station.data?.stocks ?? []

  return (
    <Screen
      title={t.report.title}
      subtitle={station.data ? t.report.subtitle(station.data.name) : undefined}
      footer={
        <Button
          testID="report-submit"
          label={locating ? t.report.locating : t.report.send}
          icon={Send}
          size="lg"
          loading={form.formState.isSubmitting}
          onPress={submit}
        />
      }
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <Controller
        control={form.control}
        name="reason"
        render={({ field }) => (
          <View className="gap-2" accessibilityRole="radiogroup">
            {REASONS.map((r) => {
              const selected = field.value === r
              return (
                <Pressable
                  key={r}
                  testID={`report-reason-${r}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  accessibilityLabel={`${t.report.reasons[r]}. ${t.report.reasonHints[r]}`}
                  onPress={() => {
                    if (!selected) haptics.selection()
                    field.onChange(r)
                  }}
                  className={cn(
                    'min-h-16 flex-row items-center gap-3 rounded-xl border px-4 py-3',
                    selected ? 'border-primary bg-primary-subtle' : 'border-border bg-surface',
                  )}
                  style={selected ? { borderWidth: 2, paddingHorizontal: 15 } : undefined}
                >
                  <View
                    className={cn(
                      'h-5 w-5 items-center justify-center rounded-full border-2',
                      selected ? 'border-primary' : 'border-input',
                    )}
                  >
                    {selected && <View className="h-2.5 w-2.5 rounded-full bg-primary" />}
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text variant="body" weight="semibold">
                      {t.report.reasons[r]}
                    </Text>
                    <Text variant="footnote" tone="muted">
                      {t.report.reasonHints[r]}
                    </Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        )}
      />

      {reason === 'out_of_stock' && (
        <Controller
          control={form.control}
          name="productId"
          render={({ field, fieldState }) => (
            <View className="gap-2">
              <Text variant="subhead" weight="medium">
                {t.report.product}
              </Text>
              <View
                className="flex-row flex-wrap gap-2"
                accessibilityRole="radiogroup"
                accessibilityLabel={t.report.product}
              >
                {stocks.map((s) => (
                  <Chip
                    key={s.productId}
                    testID={`report-product-${s.code}`}
                    label={productLabel(s)}
                    selected={field.value === s.productId}
                    onPress={() => field.onChange(s.productId)}
                  />
                ))}
              </View>
              {fieldState.error && (
                <Text variant="footnote" tone="destructive" accessibilityRole="alert">
                  {fieldState.error.message}
                </Text>
              )}
            </View>
          )}
        />
      )}

      <FormField
        testID="report-comment"
        control={form.control}
        name="comment"
        label={reason === 'other' ? t.report.comment : `${t.report.comment} (${t.common.optional})`}
        multiline
        maxLength={300}
        style={{ minHeight: 52 }}
      />

      {needsPosition && (
        <View className="flex-row gap-3 rounded-xl bg-muted p-4">
          <ShieldCheck size={20} color={colors['muted-foreground']} />
          <Text variant="footnote" tone="muted" className="flex-1">
            {t.report.proximity}
          </Text>
        </View>
      )}
    </Screen>
  )
}
