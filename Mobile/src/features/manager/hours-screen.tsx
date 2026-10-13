import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { CalendarPlus, Copy, Plus, Save, Trash2, X } from 'lucide-react-native'
import { useState } from 'react'
import { Alert, View } from 'react-native'

import { isApiError } from '@/api/errors'
import {
  addClosure,
  deleteClosure,
  invalidateOtherVersions,
  isVersionConflict,
  openingHoursQuery,
  replaceOpeningHours,
} from '@/api/manager'
import type { Closure } from '@/api/schemas'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { IconButton } from '@/components/ui/icon-button'
import { SwitchRow } from '@/components/ui/list-row'
import { Screen } from '@/components/ui/screen'
import { Section } from '@/components/ui/section'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { TextField } from '@/components/ui/text-field'
import { DateField, TimeField } from '@/components/ui/time-field'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { haptics } from '@/lib/haptics'

import {
  closureLabel,
  copyToAll,
  type DayDraft,
  draftFromApi,
  endsNextDay,
  type HoursDraft,
  MAX_RANGES,
  requestFromDraft,
  SECOND_RANGE,
  todayInBenin,
} from './hours'

/**
 * Horaires d'ouverture (D12, D64) : 2 plages par jour au plus, 24 h/24 par jour ou pour la
 * semaine, « Copier sur tous les jours », fermetures exceptionnelles (date, motif facultatif).
 */
export function HoursScreen() {
  const qc = useQueryClient()
  const q = useQuery(openingHoursQuery)
  // Saisie locale, partie de la dernière lecture de l'API (sans recopie dans un effet).
  const [edited, setDraft] = useState<HoursDraft | null>(null)
  const [closureList, setClosures] = useState<Closure[] | null>(null)
  const [writtenEtag, setEtag] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const draft = edited ?? (q.data ? draftFromApi(q.data.data) : null)
  const closures = closureList ?? q.data?.data.closures ?? []
  const etag = writtenEtag ?? q.data?.etag ?? null

  const setDay = (weekday: number, patch: Partial<DayDraft>) =>
    draft &&
    setDraft({ ...draft, days: draft.days.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)) })

  const failed = (e: unknown) => {
    haptics.error()
    if (isVersionConflict(e)) {
      // Version périmée (autre écran) : nouvelle version, la saisie reste à l'écran.
      void qc
        .fetchQuery({ ...openingHoursQuery, staleTime: 0 })
        .then((r) => setEtag(r.etag))
        .catch(() => undefined)
    }
    setError(
      isApiError(e)
        ? e.fields[0]
          ? (t.fieldErrors[e.fields[0].code] ?? e.userMessage)
          : e.userMessage
        : t.common.errorTitle,
    )
  }

  const save = async () => {
    if (!draft || !etag) return
    setBusy(true)
    setError(null)
    try {
      const res = await replaceOpeningHours(requestFromDraft(draft), etag)
      qc.setQueryData(openingHoursQuery.queryKey, res)
      void invalidateOtherVersions(qc, openingHoursQuery.queryKey)
      haptics.success()
      toast.success(t.manager.hours.saved)
      router.back()
    } catch (e) {
      failed(e)
    } finally {
      setBusy(false)
    }
  }

  const removeClosure = (c: Closure) =>
    Alert.alert(t.manager.hours.closureDeleteTitle, closureLabel(c.date), [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.common.delete,
        style: 'destructive',
        onPress: async () => {
          if (!etag) return
          try {
            setEtag(await deleteClosure(c.id, etag))
            setClosures(closures.filter((x) => x.id !== c.id))
            void invalidateOtherVersions(qc, openingHoursQuery.queryKey)
            haptics.success()
          } catch (e) {
            failed(e)
          }
        },
      },
    ])

  return (
    <Screen
      title={t.manager.hours.title}
      footer={
        <Button
          testID="hours-save"
          label={t.manager.hours.save}
          icon={Save}
          size="lg"
          loading={busy}
          disabled={!draft}
          onPress={save}
        />
      }
    >
      {error && (
        <Banner tone="danger" className="">
          {error}
        </Banner>
      )}
      {!draft ? (
        <View className="gap-3">
          <Skeleton height={56} />
          <Skeleton height={160} />
          <Skeleton height={160} />
        </View>
      ) : (
        <>
          <Card flush className="overflow-hidden">
            <SwitchRow
              testID="hours-all-week"
              title={t.manager.hours.allWeek}
              value={draft.allWeek24h}
              onValueChange={(on) => setDraft({ ...draft, allWeek24h: on })}
            />
          </Card>

          {!draft.allWeek24h &&
            draft.days.map((day) => (
              <DayCard
                key={day.weekday}
                day={day}
                onChange={(patch) => setDay(day.weekday, patch)}
                onCopyAll={() => {
                  setDraft({ ...draft, days: copyToAll(draft.days, day.weekday) })
                  haptics.selection()
                  toast.info(t.manager.hours.copied(t.manager.hours.weekdays[day.weekday - 1]!.toLowerCase()))
                }}
              />
            ))}

          <Section title={t.manager.hours.closures}>
            <Text variant="footnote" tone="muted">
              {t.manager.hours.closuresHint}
            </Text>
            {closures.length === 0 ? (
              <Text variant="subhead" tone="muted">
                {t.manager.hours.noClosure}
              </Text>
            ) : (
              <Card flush className="overflow-hidden">
                {closures.map((c, i) => (
                  <View
                    key={c.id}
                    className={`min-h-14 flex-row items-center gap-3 py-1 pl-4 pr-1 ${i > 0 ? 'border-t border-border' : ''}`}
                  >
                    <View className="flex-1">
                      <Text variant="body" weight="medium">
                        {closureLabel(c.date)}
                      </Text>
                      {c.reason && (
                        <Text variant="footnote" tone="muted">
                          {c.reason}
                        </Text>
                      )}
                    </View>
                    <IconButton
                      icon={Trash2}
                      label={t.manager.hours.closureDelete(closureLabel(c.date))}
                      onPress={() => removeClosure(c)}
                    />
                  </View>
                ))}
              </Card>
            )}
            <AddClosure
              onAdd={async (date, reason) => {
                if (!etag) return false
                try {
                  const res = await addClosure(reason ? { date, reason } : { date }, etag)
                  setEtag(res.etag)
                  setClosures([...closures, res.data].sort((a, b) => a.date.localeCompare(b.date)))
                  void invalidateOtherVersions(qc, openingHoursQuery.queryKey)
                  haptics.success()
                  return true
                } catch (e) {
                  failed(e)
                  return false
                }
              }}
            />
          </Section>
        </>
      )}
    </Screen>
  )
}

function DayCard({
  day,
  onChange,
  onCopyAll,
}: {
  day: DayDraft
  onChange: (patch: Partial<DayDraft>) => void
  onCopyAll: () => void
}) {
  const name = t.manager.hours.weekdays[day.weekday - 1]!
  return (
    <Card flush className="overflow-hidden" testID={`hours-day-${day.weekday}`}>
      <SwitchRow
        testID={`hours-day-${day.weekday}-open`}
        title={name}
        subtitle={day.open ? (day.is24h ? t.manager.hours.allDay : t.manager.hours.open) : t.manager.hours.closed}
        value={day.open}
        onValueChange={(open) => onChange({ open })}
      />
      {day.open && (
        <View className="gap-3 border-t border-border px-4 pb-4 pt-1">
          <SwitchRow
            testID={`hours-day-${day.weekday}-24h`}
            title={t.manager.hours.allDay}
            value={day.is24h}
            onValueChange={(is24h) => onChange({ is24h })}
          />
          {!day.is24h &&
            day.ranges.map((r, i) => (
              <View key={i} className="gap-1">
                <View className="flex-row items-end gap-2">
                  <TimeField
                    testID={`hours-day-${day.weekday}-r${i}-opens`}
                    className="flex-1"
                    label={t.manager.hours.opens}
                    value={r.opens}
                    onChange={(opens) =>
                      onChange({ ranges: day.ranges.map((x, j) => (j === i ? { ...x, opens } : x)) })
                    }
                  />
                  <TimeField
                    testID={`hours-day-${day.weekday}-r${i}-closes`}
                    className="flex-1"
                    label={t.manager.hours.closes}
                    value={r.closes}
                    onChange={(closes) =>
                      onChange({ ranges: day.ranges.map((x, j) => (j === i ? { ...x, closes } : x)) })
                    }
                  />
                  {day.ranges.length > 1 && (
                    <IconButton
                      icon={X}
                      label={`${t.manager.hours.removeRange} : ${t.manager.hours.rangeLabel(name, i + 1)}`}
                      onPress={() => onChange({ ranges: day.ranges.filter((_, j) => j !== i) })}
                    />
                  )}
                </View>
                {endsNextDay(r) && (
                  <Text variant="caption" tone="muted">
                    {t.manager.hours.closes} {t.manager.hours.nextDay}
                  </Text>
                )}
              </View>
            ))}
          <View className="flex-row flex-wrap gap-2">
            {!day.is24h && day.ranges.length < MAX_RANGES && (
              <Button
                label={t.manager.hours.addRange}
                icon={Plus}
                size="sm"
                variant="outline"
                onPress={() => onChange({ ranges: [...day.ranges, SECOND_RANGE] })}
              />
            )}
            <Button
              testID={`hours-day-${day.weekday}-copy`}
              label={t.manager.hours.copyAll}
              icon={Copy}
              size="sm"
              variant="ghost"
              onPress={onCopyAll}
            />
          </View>
        </View>
      )}
    </Card>
  )
}

function AddClosure({ onAdd }: { onAdd: (date: string, reason: string) => Promise<boolean> }) {
  const today = todayInBenin()
  const [date, setDate] = useState(today)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const min = new Date(`${today}T12:00:00`)
  const max = new Date(min)
  max.setFullYear(max.getFullYear() + 1)
  max.setDate(max.getDate() - 1)
  return (
    <Card className="gap-3">
      <Text variant="headline">{t.manager.hours.addClosure}</Text>
      <DateField
        testID="closure-date"
        label={t.manager.hours.closureDate}
        value={date}
        display={closureLabel(date)}
        onChange={setDate}
        min={min}
        max={max}
      />
      <TextField
        testID="closure-reason"
        label={t.manager.hours.closureReason}
        value={reason}
        onChangeText={setReason}
        maxLength={200}
      />
      <Button
        testID="closure-add"
        label={t.manager.hours.closureAdd}
        icon={CalendarPlus}
        variant="outline"
        loading={busy}
        onPress={async () => {
          setBusy(true)
          if (await onAdd(date, reason.trim())) setReason('')
          setBusy(false)
        }}
      />
    </Card>
  )
}
